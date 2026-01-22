// Supabase Edge Function: Batch Verification Proxy
// This function securely calls the batch.1key.me API

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Get authorization header
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(
                JSON.stringify({ success: false, message: '未授权访问' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Initialize Supabase client
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // Get user from JWT
        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: userError } = await supabase.auth.getUser(token)

        if (userError || !user) {
            return new Response(
                JSON.stringify({ success: false, message: '用户验证失败' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Parse request body
        const { verificationIds } = await req.json()

        if (!verificationIds || !Array.isArray(verificationIds) || verificationIds.length === 0) {
            return new Response(
                JSON.stringify({ success: false, message: '请提供验证ID' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Get verify config from system_config
        const { data: configData } = await supabase
            .from('system_config')
            .select('config_value')
            .eq('config_key', 'verify')
            .single()

        const config = configData?.config_value || {}
        const pricePerVerify = config.price_per_verify || 3
        const batchApiKey = config.batch_api_key

        if (!batchApiKey) {
            return new Response(
                JSON.stringify({ success: false, message: '验证服务未配置' }),
                { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Check user balance from points_balance table
        const { data: balanceData } = await supabase
            .from('points_balance')
            .select('total_balance')
            .eq('user_id', user.id)
            .single()

        const userPoints = balanceData?.total_balance || 0
        const totalCost = pricePerVerify * verificationIds.length

        if (userPoints < totalCost) {
            return new Response(
                JSON.stringify({
                    success: false,
                    message: `积分不足，需要 ${totalCost} 积分，当前余额 ${userPoints}`
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Call batch.1key.me API with browser-like headers
        const batchResponse = await fetch('https://batch.1key.me/api/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Origin': 'https://batch.1key.me',
                'Referer': 'https://batch.1key.me/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            body: JSON.stringify({
                hCaptchaToken: batchApiKey,
                verificationIds: verificationIds,
            }),
        })

        if (!batchResponse.ok) {
            const errorText = await batchResponse.text()
            console.error('Batch API error:', errorText)
            return new Response(
                JSON.stringify({ success: false, message: '验证服务暂时不可用' }),
                { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Handle SSE response from batch API
        const reader = batchResponse.body?.getReader()
        const decoder = new TextDecoder()
        let results: any[] = []
        let finalResult = null

        if (reader) {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value)
                const lines = chunk.split('\n').filter(line => line.trim())

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        try {
                            const data = JSON.parse(line.slice(5).trim())
                            if (data.verificationId) {
                                results.push(data)
                                finalResult = data
                            }
                        } catch (e) {
                            // Ignore parse errors for non-JSON lines
                        }
                    }
                }
            }
        }

        // Deduct points after successful verification
        const { error: deductError } = await supabase.rpc('fn_deduct_points', {
            p_target_user_id: user.id,
            p_amount: totalCost,
            p_reason: `Gemini验证服务 x${verificationIds.length}`
        })

        if (deductError) {
            console.error('Failed to deduct points:', deductError)
            // Still return success since verification was done
        }

        // Log the verification
        await supabase.from('verification_logs').insert({
            user_id: user.id,
            verification_ids: verificationIds,
            results: results,
            points_cost: totalCost,
            created_at: new Date().toISOString()
        }).catch(e => console.warn('Failed to log verification:', e))

        return new Response(
            JSON.stringify({
                success: true,
                message: finalResult?.currentStep === 'success' ? '验证成功' : (finalResult?.message || '验证完成'),
                results: results,
                pointsDeducted: totalCost
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Edge function error:', error)
        return new Response(
            JSON.stringify({ success: false, message: '服务器错误' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
