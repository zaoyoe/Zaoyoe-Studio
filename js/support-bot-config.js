(function (global) {
    'use strict';

    global.ZaoyoeSupportBotConfig = {
        version: '20260330_SUPPORT_FLOW_1',
        rootMenus: ['exchange', 'shop', 'verify', 'human'],
        contexts: {
            default: {
                title: {
                    zh: '常用入口',
                    en: 'Quick Help'
                },
                intro: {
                    zh: '这个站点主要解决兑换、卡密和任务状态问题，优先推荐自助排查。',
                    en: 'This site mostly needs help with redemptions, delivered keys, and task status, so self-serve checks come first.'
                },
                shortcuts: ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat']
            },
            shop: {
                title: {
                    zh: '商城快捷入口',
                    en: 'Shop Shortcuts'
                },
                intro: {
                    zh: '如果你是“兑换后没拿到内容”这一类问题，先从这里查，通常比等人工更快。',
                    en: 'If your issue is “I redeemed but did not receive the content”, start here. It is usually faster than waiting for a human reply.'
                },
                shortcuts: ['shop_order_status', 'shop_order_content', 'discount_help', 'create_ticket', 'live_chat']
            },
            verify: {
                title: {
                    zh: '验证快捷入口',
                    en: 'Verify Shortcuts'
                },
                intro: {
                    zh: '验证页最常见的是查任务进度、失败原因和重提前检查。',
                    en: 'On the verify page, the most common needs are task progress, failure reasons, and checks before retrying.'
                },
                shortcuts: ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket', 'live_chat']
            }
        },
        menus: {
            exchange: {
                title: {
                    zh: '兑换与卡密',
                    en: 'Codes & Redeem'
                },
                description: {
                    zh: '适合兑换码状态、直接兑换、爱发电订单找回。',
                    en: 'For redemption status, direct redeem, and Afdian order lookup.'
                },
                items: ['code_status', 'redeem_code', 'afdian_lookup']
            },
            shop: {
                title: {
                    zh: '商城订单',
                    en: 'Shop Orders'
                },
                description: {
                    zh: '适合查订单发放状态、查看已发放内容、优惠码问题。',
                    en: 'For delivery status, delivered content, and discount code issues.'
                },
                items: ['shop_order_status', 'shop_order_content', 'discount_help']
            },
            verify: {
                title: {
                    zh: '验证任务',
                    en: 'Verify Tasks'
                },
                description: {
                    zh: '适合查任务进度、失败原因，以及重新提交前的检查。',
                    en: 'For task progress, failure reasons, and checks before resubmitting.'
                },
                items: ['verify_task_status', 'verify_failure_help', 'verify_precheck']
            },
            human: {
                title: {
                    zh: '人工处理',
                    en: 'Human Help'
                },
                description: {
                    zh: '自助排查解决不了时，可以查看工单结果、继续提交工单，或转 Telegram。',
                    en: 'If self-serve did not solve it, review ticket results, submit a ticket, or continue in Telegram.'
                },
                items: ['ticket_history', 'create_ticket', 'tg_support', 'live_chat']
            }
        },
        actions: {
            code_status: {
                label: {
                    zh: '查兑换码状态',
                    en: 'Check Code Status'
                },
                mode: 'support_api',
                apiAction: 'code_status',
                requiresAuth: true,
                prompt: {
                    zh: '把兑换码或外部订单号发我，我帮你看是未使用、已使用、已过期还是无效。',
                    en: 'Send me the redemption code or external order number and I will check whether it is unused, used, expired, or invalid.'
                },
                placeholder: {
                    zh: '输入兑换码或外部订单号',
                    en: 'Enter a code or external order number'
                },
                inputHint: {
                    zh: '示例：`ZY-ABCD-1234` 或外部订单号',
                    en: 'Example: `ZY-ABCD-1234` or an external order number'
                }
            },
            redeem_code: {
                label: {
                    zh: '立即兑换兑换码',
                    en: 'Redeem Code Now'
                },
                mode: 'rpc',
                rpcName: 'fn_redeem_code',
                requiresAuth: true,
                prompt: {
                    zh: '把兑换码发我，我会直接发起兑换，并告诉你到账积分。',
                    en: 'Send me the code and I will redeem it and tell you how many points were credited.'
                },
                placeholder: {
                    zh: '输入要兑换的兑换码',
                    en: 'Enter the code to redeem'
                },
                inputHint: {
                    zh: '示例：`ZY-ABCD-1234`',
                    en: 'Example: `ZY-ABCD-1234`'
                }
            },
            afdian_lookup: {
                label: {
                    zh: '爱发电订单找回兑换码',
                    en: 'Find Afdian Redeem Code'
                },
                mode: 'support_api',
                apiAction: 'afdian_lookup',
                requiresAuth: true,
                prompt: {
                    zh: '把爱发电订单号发我，我帮你找回兑换码，并确认是否已经被领取。',
                    en: 'Send me the Afdian order number and I will recover the redeem code and confirm whether it has already been claimed.'
                },
                placeholder: {
                    zh: '输入爱发电订单号',
                    en: 'Enter the Afdian order number'
                },
                inputHint: {
                    zh: '只支持查询当前登录账号自己的订单。',
                    en: 'Only orders belonging to the current logged-in account can be queried.'
                }
            },
            shop_order_status: {
                label: {
                    zh: '我的订单没到账',
                    en: 'My Order Did Not Arrive'
                },
                mode: 'support_api',
                apiAction: 'shop_order_status',
                requiresAuth: true,
                prompt: {
                    zh: '把商城订单号发我，我帮你看是已发放、待履约，还是出现了发放异常。',
                    en: 'Send me the shop order number and I will check whether it was delivered, is pending, or hit a delivery issue.'
                },
                placeholder: {
                    zh: '输入商城订单号',
                    en: 'Enter the shop order number'
                },
                inputHint: {
                    zh: '示例：钱包里的订单编号',
                    en: 'Example: the order ID shown in your wallet'
                }
            },
            shop_order_content: {
                label: {
                    zh: '查看已发放内容',
                    en: 'View Delivered Content'
                },
                mode: 'support_api',
                apiAction: 'shop_order_content',
                requiresAuth: true,
                prompt: {
                    zh: '把商城订单号发我，我把已发放的内容摘要列给你。',
                    en: 'Send me the shop order number and I will list a summary of the delivered content.'
                },
                placeholder: {
                    zh: '输入商城订单号',
                    en: 'Enter the shop order number'
                },
                inputHint: {
                    zh: '如果内容较长，我会只展示摘要，你可以再去钱包详情页复制完整内容。',
                    en: 'If the content is long, I will show a summary and you can copy the full content from the wallet detail page.'
                }
            },
            discount_help: {
                label: {
                    zh: '优惠码不能用',
                    en: 'Discount Code Issue'
                },
                mode: 'static',
                body: {
                    zh: '优惠码问题通常不是“系统坏了”，而是命中了使用条件。先检查这几项：',
                    en: 'Discount code issues usually mean usage conditions were not met. Check these first:'
                },
                checklist: {
                    zh: [
                        '优惠码是否已经过期',
                        '是否达到使用次数上限',
                        '是否只适用于特定商品',
                        '是否有最低购买数量或购买次数限制',
                        '大小写和空格是否输入正确'
                    ],
                    en: [
                        'Whether the code has expired',
                        'Whether it has reached its usage limit',
                        'Whether it only applies to a specific product',
                        'Whether there is a minimum quantity or purchase count rule',
                        'Whether the code was entered with the correct casing and spacing'
                    ]
                }
            },
            verify_task_status: {
                label: {
                    zh: '查询任务进度',
                    en: 'Check Task Status'
                },
                mode: 'verify_status',
                requiresAuth: true,
                prompt: {
                    zh: '把任务号发我，我帮你看现在是排队中、处理中，还是已经完成。',
                    en: 'Send me the task ID and I will check whether it is queued, processing, or already completed.'
                },
                placeholder: {
                    zh: '输入验证任务号',
                    en: 'Enter the verify task ID'
                },
                inputHint: {
                    zh: '示例：钱包详情里的任务编号',
                    en: 'Example: the task ID shown in the wallet detail view'
                }
            },
            verify_failure_help: {
                label: {
                    zh: '为什么失败',
                    en: 'Why Did It Fail'
                },
                mode: 'verify_status',
                requiresAuth: true,
                failureOnly: true,
                prompt: {
                    zh: '把任务号发我，我帮你把失败原因翻译成人话。',
                    en: 'Send me the task ID and I will explain the failure in plain language.'
                },
                placeholder: {
                    zh: '输入失败任务号',
                    en: 'Enter the failed task ID'
                },
                inputHint: {
                    zh: '常见原因包括地区不支持、SSO 域邮箱不支持、上游接口异常。',
                    en: 'Common reasons include unsupported regions, SSO domain emails, and upstream service issues.'
                }
            },
            verify_precheck: {
                label: {
                    zh: '重新提交前检查',
                    en: 'Check Before Retry'
                },
                mode: 'static',
                body: {
                    zh: '重提之前建议先确认这些条件，能减少重复扣分和无效重试：',
                    en: 'Before retrying, confirm these conditions to avoid repeated charges and ineffective retries:'
                },
                checklist: {
                    zh: [
                        '账号所在地区是否支持 Google One',
                        '邮箱是否为普通账号，而不是 SSO 域名账号',
                        '当前账号是否已经有冲突中的试用记录',
                        '上次失败是否属于上游临时错误，可以稍后再试',
                        '登录状态和积分余额是否正常'
                    ],
                    en: [
                        'Whether the account region supports Google One',
                        'Whether the email is a normal account instead of an SSO domain account',
                        'Whether there is already a conflicting trial attempt on the account',
                        'Whether the previous failure was a temporary upstream error and worth retrying later',
                        'Whether login state and point balance are normal'
                    ]
                }
            },
            create_ticket: {
                label: {
                    zh: '提交问题工单',
                    en: 'Submit Ticket'
                },
                mode: 'ticket',
                requiresAuth: true,
                prompt: {
                    zh: '把“关联 ID + 问题描述”发我，我会帮你生成一条客服工单。',
                    en: 'Send me the reference ID plus a problem description and I will create a support ticket for you.'
                },
                placeholder: {
                    zh: '输入关联 ID 和问题描述',
                    en: 'Enter the reference ID and issue description'
                },
                inputHint: {
                    zh: '示例：`order:订单号 卡密未到账`、`task:任务号 一直失败`、`code:兑换码 显示已使用`',
                    en: 'Example: `order:ORDER_ID content not delivered`, `task:TASK_ID keeps failing`, `code:CODE shows used`'
                }
            },
            ticket_history: {
                label: {
                    zh: '查看工单结果',
                    en: 'View Ticket Results'
                },
                mode: 'ticket_history',
                requiresAuth: true,
                prompt: {
                    zh: '这里会列出你最近的工单处理状态、客服结论，以及仍待处理的记录。',
                    en: 'View your recent ticket statuses, support outcomes, and any cases still waiting for review.'
                }
            },
            tg_support: {
                label: {
                    zh: 'TG 人工客服',
                    en: 'Telegram Support'
                },
                mode: 'link',
                url: 'https://t.me/zaoyoe',
                body: {
                    zh: '如果你已经完成自助排查，仍然解决不了，可以直接带上订单号、任务号或兑换码去 TG。',
                    en: 'If self-service did not solve it, go to Telegram with your order ID, task ID, or code.'
                }
            },
            live_chat: {
                label: {
                    zh: '在线客服',
                    en: 'Live Chat'
                },
                mode: 'live_chat',
                body: {
                    zh: '如果你要直接留言给站内客服，可以切换到在线客服模式继续发送文字消息。',
                    en: 'If you want to leave a direct message for on-site support, switch to live chat mode and continue there.'
                }
            }
        }
    };
}(typeof window !== 'undefined' ? window : globalThis));
