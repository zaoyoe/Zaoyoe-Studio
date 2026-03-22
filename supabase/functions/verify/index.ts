import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    return new Response(
        JSON.stringify({
            success: false,
            code: 'legacy_verify_endpoint_disabled',
            message: 'Legacy verify edge function has been disabled. Use the authenticated /api/verify flow instead.'
        }),
        {
            status: 410,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
            }
        }
    )
})
