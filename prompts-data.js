const PROMPTS = [
    {
        "id": "prompt-1",
        "title": "3D chibi-style 微缩商店",
        "tags": [
            "3D Art"
        ],
        "description": "# 3D chibi-style 微缩商店\n- prompt\n    3D chibi-style miniature concept store of {Brand Name}, creatively designed with an exterior inspired by the brand'...",
        "prompt": "# 3D chibi-style 微缩商店\n- prompt\n    3D chibi-style miniature concept store of {Brand Name}, creatively designed with an exterior inspired by the brand's most iconic product or packaging (such as a giant {brand's core product, e.g., chicken bucket/hamburger/donut/roast duck}). The store features two floors with large glass windows clearly showcasing the cozy and finely decorated interior: {brand's primary color}-themed decor, warm lighting, and busy staff dressed in outfits matching the brand. Adorable tiny figures stroll or sit along the street, surrounded by benches, street lamps, and potted plants, creating a charming urban scene. Rendered in a miniature cityscape style using Cinema 4D, with a blind-box toy aesthetic, rich in details and realism, and bathed in soft lighting that evokes a relaxing afternoon atmosphere. --ar 2:3",
        "images": [
            "assets/prompts/3D_chibi_style______1_1.png",
            "assets/prompts/3D_chibi_style______1_2.png"
        ],
        "dominantColors": [
            "gray",
            "black",
            "white"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "giant coffee cup",
                    "Starbucks",
                    "characters",
                    "barista",
                    "potted plants",
                    "street lamp",
                    "bench",
                    "buildings",
                    "coffee cup",
                    "straw"
                ],
                "zh": [
                    "巨型咖啡杯",
                    "星巴克",
                    "人物",
                    "咖啡师",
                    "盆栽植物",
                    "路灯",
                    "长椅",
                    "建筑物",
                    "咖啡杯",
                    "吸管"
                ]
            },
            "scenes": {
                "en": [
                    "city street",
                    "cafe",
                    "outdoor",
                    "daytime",
                    "street view",
                    "urban scene"
                ],
                "zh": [
                    "城市街道",
                    "咖啡馆",
                    "户外",
                    "白天",
                    "街景",
                    "都市场景"
                ]
            },
            "styles": {
                "en": [
                    "3D art",
                    "miniature",
                    "whimsical",
                    "cartoon style",
                    "cute",
                    "digital art",
                    "rendered",
                    "stylized"
                ],
                "zh": [
                    "3D艺术",
                    "微缩",
                    "奇幻",
                    "卡通风格",
                    "可爱",
                    "数字艺术",
                    "渲染",
                    "风格化"
                ]
            },
            "mood": {
                "en": [
                    "playful",
                    "cheerful",
                    "cozy",
                    "inviting",
                    "peaceful",
                    "lively",
                    "pleasant"
                ],
                "zh": [
                    "俏皮",
                    "欢快",
                    "舒适",
                    "诱人",
                    "宁静",
                    "活泼",
                    "愉悦"
                ]
            }
        }
    },
    {
        "id": "prompt-2",
        "title": "9宫格+裸感3D",
        "tags": [
            "3D Art"
        ],
        "description": "# 9宫格+裸感3D\n- Prompt Template\n    Create a 2:3 portrait fashion poster featuring THE SAME WOMAN in THE SAME OUTFIT shown in 9 different magazine editor...",
        "prompt": "# 9宫格+裸感3D\n- Prompt Template\n    Create a 2:3 portrait fashion poster featuring THE SAME WOMAN in THE SAME OUTFIT shown in 9 different magazine editorial styles with 3D pop-out effect:\n    CHARACTER CONSISTENCY (CRITICAL - HIGHEST PRIORITY):\n    THE SAME female fashion model appears in ALL 9 positions:\n    - Same face, same facial features, same skin tone, same body type\n    - Cold-beauty aesthetic: sharp jawline, high cheekbones, aloof minimalist expression\n    - Early-20s Chinese/Korean fashion model with editorial face\n    - Her identity NEVER changes across all 9 appearances\n    OUTFIT CONSISTENCY (NEW RULE):\n    THE SAME OUTFIT in all 9 positions:\n    - Oversized black cashmere V-neck sweater (slightly loose fit)\n    - High-waisted wide-leg pure white tailored trousers\n    - Black leather loafers with subtle gold horsebit detail\n    - Neat low bun with slightly messy front strands\n    - Small gold hoop earrings, thin gold chain necklace\n    SAME CLOTHING - only photography style, pose, and angle vary\n    BACKGROUND LAYER (Z=0) - 3×3 Grid with 8 Visible Magazine Styles:\n    Grid Structure & Occlusion:\n    - Standard 3×3 layout = 9 magazine editorial shots\n    - **8 visible cells** (center cell [2,2] COMPLETELY OCCLUDED by 3D figure)\n    - Cells separated by DISTINCT THICK WHITE LINES (3-4px) for clear separation\n    [1,1] Vogue Editorial Style:\n    - Same woman, same outfit\n    - Pose: Standing tall, hand in pocket, direct powerful gaze\n    - Style: High contrast lighting, dramatic shadows, sophisticated\n    - Sharp focus, clear face\n    [1,2] Harper's Bazaar Style:\n    - Same woman, same outfit\n    - Pose: Side profile, looking over shoulder\n    - Style: Soft glamour lighting, elegant mood\n    - Sharp focus, clear face\n    [1,3] Elle Street Style:\n    - Same woman, same outfit\n    - Pose: Walking motion, casual confident stride\n    - Style: Natural daylight, urban chic aesthetic\n    - Sharp focus, clear face\n    [2,1] i-D Magazine Style:\n    - Same woman, same outfit\n    - Pose: Sitting on minimal cube, legs crossed\n    - Style: Bold graphic composition, colorful backdrop\n    - Sharp focus, clear face\n    [2,3] Dazed & Confused Style:\n    - Same woman, same outfit\n    - Pose: Dynamic movement, fabric flowing\n    - Style: Experimental angles, artistic editorial\n    - Sharp focus, clear face\n    [3,1] Marie Claire Corporate Chic:\n    - Same woman, same outfit\n    - Pose: Power stance, arms crossed professionally\n    - Style: Clean corporate aesthetic, neutral tones\n    - Sharp focus, clear face\n    [3,2] GQ Minimalist Style:\n    - Same woman, same outfit\n    - Pose: Leaning against wall, relaxed elegance\n    - Style: Architectural composition, clean lines\n    - Sharp focus, clear face\n    [3,3] W Magazine Avant-Garde:\n    - Same woman, same outfit\n    - Pose: Artistic pose, hand gestures expressive\n    - Style: Bold contrast, fashion-forward editorial\n    - Sharp focus, clear face\n    CRITICAL TECHNICAL SPECS FOR BACKGROUND GRID:\n    - Deep depth of field (f/16) - ALL faces sharp and clear\n    - NO bokeh, NO blur, NO out-of-focus areas\n    - Even bright studio lighting across all cells\n    - High resolution faces in every cell\n    - Thick white grid lines clearly visible between cells\n    - Background color: Bright minimalist concrete/white studio\n    FOREGROUND LAYER (Z=5-10cm forward) - Hyper-Realistic 3D Pop-out:\n    THE SAME WOMAN, SAME OUTFIT (Look 5 - Most Dramatic):\n    - Massive hyper-realistic full-body shot dominating the center\n    - Positioned at EXACT CENTER, completely occluding center cell [2,2]\n    - **Head touches very top edge of canvas**\n    - **Shoes touch very bottom edge of canvas**\n    - Occupies MAXIMUM vertical space for strong 3D illusion\n    Pose:\n    - Dynamic walking forward motion\n    - Confident stride, mid-step\n    - Hand on hip or naturally swinging\n    - Direct gaze at camera, commanding presence\n    - Full body visible from head to toe\n    Technical Execution:\n    - Figure extends 5-10cm forward from background plane\n    - Hyper-realistic detail (skin texture, fabric weave visible)\n    - +20% saturation compared to background for \"pop forward\" effect\n    - Slightly sharper focus than background (but background still sharp)\n    OCCLUSION MECHANICS (9格 - 1格遮挡 = 8格可见):\n    Complete Occlusion:\n    - Figure's body COMPLETELY covers center cell [2,2] (100% invisible)\n    - Center magazine shot is fully hidden behind 3D figure\n    Partial Occlusion (Natural Edge Overlap):\n    - Top [1,2]: Hair/head overlaps 10-15% into Harper's Bazaar shot\n    - Left [2,1]: Left arm/sleeve overlaps 15-20% into i-D shot\n    - Right [2,3]: Right arm overlaps 15-20% into Dazed shot\n    - Bottom [3,2]: Legs/feet overlap 10-15% into GQ shot\n    - Overlaps break the white grid boundaries naturally\n    Edge Treatment:\n    - Soft organic transitions, NO hard cutout edges\n    - Figure appears to physically exist in front of the grid\n    - Like a 3D cardboard cutout standing in front of a poster\n    DEPTH EFFECTS:\n    Shadows:\n    - Drop shadow from 3D figure onto grid background\n    * Blur: 12px\n    * Color: rgba(0,0,0,0.25) (slightly darker for stronger effect)\n    * Offset: X=6px, Y=10px\n    - Contact shadow where figure \"stands\" on background\n    * Blur: 8px\n    * Color: rgba(0,0,0,0.35)\n    * Creates grounding effect\n    Lighting:\n    - Background grid: Even bright studio lighting (no dramatic shadows)\n    - Foreground figure:\n    * Key light upper left 45°\n    * Subtle rim light on edges for separation\n    * Slightly more dramatic lighting than background\n    - Consistent lighting direction across all elements\n    Separation Techniques:\n    - Slight brightness difference (foreground +10% brighter)\n    - Slight saturation boost (foreground +20% more saturated)\n    - Subtle sharpening halo around figure edges\n    - Clear Z-axis spatial hierarchy\n    CONSISTENCY RULES (ABSOLUTE PRIORITY):\n    Same Woman Verification:\n    - Same face in all 9 positions\n    - Same facial structure, eyes, nose, lips, jawline\n    - Same cold-beauty editorial expression\n    - Same hair styling (low bun, messy strands)\n    - Same age, same ethnicity, same beauty\n    Same Outfit Verification:\n    - Same black sweater in all 9 shots\n    - Same white trousers in all 9 shots\n    - Same accessories (earrings, necklace, loafers)\n    - Only photography style and pose differ\n    What Changes:\n    -\n    Magazine editorial style (lighting, mood, composition)\n    -\n    Pose and body angle\n    -\n    Camera angle and framing\n    -\n    Photographic treatment\n    What NEVER Changes:\n    -\n    The woman's face or identity\n    -\n    The outfit or clothing items\n    -\n    The accessories\n    -\n    The overall styling concept\n    TECHNICAL SPECIFICATIONS:\n    Image Composition:\n    - Aspect ratio: 2:3 portrait (or 9:16 vertical)\n    - Resolution: 2000×3000 pixels (or higher)\n    - Color mode: RGB, sRGB color space\n    - Quality: Professional editorial fashion photography\n    Camera & Focus:\n    - **Deep depth of field (f/16 or higher)**\n    - **NO selective focus, NO bokeh, NO blur**\n    - **ALL faces in background grid MUST be sharp and clear**\n    - Foreground figure slightly sharper for hierarchy\n    - Both layers fully illuminated and visible\n    Environment:\n    - Bright minimalist indoor studio\n    - Concrete walls or pure white background\n    - Optional: Minimal green plants for visual interest\n    - Clean, uncluttered aesthetic\n    - Quiet luxury mood\n    Layout:\n    - Background: Clear 3×3 grid with THICK WHITE LINES visible\n    - Foreground: Massive full-body figure breaking grid boundaries\n    - Surreal creative collage composition\n    - Graphic and editorial feel\n    FORBIDDEN ELEMENTS (严格禁止):\n    Character & Outfit:\n    -\n    Different women in different cells\n    -\n    Different outfits or clothing changes\n    -\n    Changing facial features or styling\n    -\n    Multiple models instead of one person\n    Technical:\n    -\n    Blurred background or bokeh effect\n    -\n    Out of focus faces in grid\n    -\n    Shallow depth of field\n    -\n    Missing or unclear grid lines\n    -\n    Dark shadows obscuring faces\n    -\n    Low resolution or pixelation\n    -\n    Deformed limbs or merging bodies\n    -\n    Messy composition\n    Structure:\n    -\n    4×4 or other grid sizes (must be 3×3)\n    -\n    All 9 cells visible (center must be occluded)\n    -\n    Flat composition (must have clear 3D depth)\n    -\n    Hard cutout edges on foreground figure\n    QUALITY CHECKLIST:\n    Before Generation:\n    - [ ] Same woman's face in all 9 positions?\n    - [ ] Same outfit in all 9 positions?\n    - [ ] Each cell shows different magazine editorial style?\n    - [ ] Center cell [2,2] completely hidden?\n    - [ ] 8 visible background cells clearly defined?\n    - [ ] Thick white grid lines visible?\n    - [ ] ALL background faces sharp and clear (no blur)?\n    - [ ] Foreground figure full-body, head-to-toe?\n    - [ ] Figure extends maximum vertical space?\n    - [ ] Clear 3D pop-out effect?\n    - [ ] Natural edge overlaps into adjacent cells?\n    - [ ] Shadows present for depth?\n    - [ ] Deep depth of field maintained?\n    MIDJOURNEY/AI COMMAND FORMAT:\n    /imagine prompt: A surreal 3x3 fashion grid collage with THICK WHITE LINES separating cells. Background shows THE SAME Chinese fashion model in THE SAME black oversized sweater and white wide-leg trousers in 8 different magazine editorial styles (Vogue, Harper's Bazaar, Elle, i-D, Dazed, Marie Claire, GQ, W Magazine) - various poses but identical outfit. CENTER CELL HIDDEN. OVERLAID by a massive hyper-realistic full-body 3D cut-out of the SAME MODEL in SAME OUTFIT walking forward, head touching top edge, feet touching bottom edge. ALL faces sharp and in focus, deep depth of field f/16, no blur anywhere, bright studio lighting, clear white grid lines, strong 3D pop-out effect, editorial photography, same woman same clothes 9 times, 8k resolution --ar 2:3 --v 6.1 --stylize 300 --quality 2\n    MATHEMATICAL LOGIC:\n    Same woman × Same outfit × 9 different magazine editorial styles arranged in 3×3 grid. Center style completely occluded by 3D foreground version = 8 visible background editorial styles + 1 foreground 3D editorial = 9 total appearances of ONE PERSON in ONE OUTFIT with NINE photographic interpretations.",
        "images": [
            "assets/prompts/9_____3D_2_1.png",
            "assets/prompts/9_____3D_2_2.png",
            "assets/prompts/9_____3D_2_3.png",
            "assets/prompts/9_____3D_2_4.png",
            "assets/prompts/9_____3D_2_5.png",
            "assets/prompts/9_____3D_2_6.png"
        ],
        "dominantColors": [
            "gray",
            "black",
            "orange"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "model",
                    "woman",
                    "sweater",
                    "pants",
                    "shoes",
                    "magazine logo"
                ],
                "zh": [
                    "模特",
                    "女性",
                    "毛衣",
                    "裤子",
                    "鞋子",
                    "杂志标志"
                ]
            },
            "scenes": {
                "en": [
                    "studio",
                    "fashion editorial",
                    "photoshoot",
                    "magazine cover",
                    "urban background",
                    "plain background"
                ],
                "zh": [
                    "影棚",
                    "时尚大片",
                    "拍摄",
                    "杂志封面",
                    "都市背景",
                    "纯色背景"
                ]
            },
            "styles": {
                "en": [
                    "fashion photography",
                    "editorial style",
                    "minimalist",
                    "modern",
                    "casual chic",
                    "monochromatic",
                    "clean aesthetic"
                ],
                "zh": [
                    "时尚摄影",
                    "编辑风格",
                    "简约",
                    "现代",
                    "休闲时尚",
                    "单色",
                    "干净美学"
                ]
            },
            "mood": {
                "en": [
                    "confident",
                    "stylish",
                    "calm",
                    "elegant",
                    "professional",
                    "chic"
                ],
                "zh": [
                    "自信",
                    "时尚",
                    "平静",
                    "优雅",
                    "专业",
                    "别致"
                ]
            }
        }
    },
    {
        "id": "prompt-3",
        "title": "Ai 动画 百事",
        "tags": [
            "3D Art"
        ],
        "description": "# Ai 动画 百事\n- Prompt Template\n    Ai Animation Pepsi gemini Nano Banana 3.0\n    Ai 动画 百事 gemini 香蕉 3.0\n    Prompt:\n    提示：\n    {\n      \"image_generatio...",
        "prompt": "# Ai 动画 百事\n- Prompt Template\n    Ai Animation Pepsi gemini Nano Banana 3.0\n    Ai 动画 百事 gemini 香蕉 3.0\n    Prompt:\n    提示：\n    {\n      \"image_generation_prompts\": [\n        {\n          \"id\": 1,\n          \"title\": \"Pepsi Skyscraper Construction\",\n          \"subject\": {\n            \"main_element\": \"Giant Black Pepsi can\",\n            \"orientation\": \"Positioned horizontally like a skyscraper\",\n            \"details\": [\n              \"Iconic red, blue, and white design\",\n              \"Sparkling droplets of water on surface\"\n            ]\n          },\n          \"environment\": {\n            \"setting\": \"Checkered diner tablecloth\",\n            \"elements\": [\n              \"Intricate scaffolding\",\n              \"Miniature construction workers swarm\"\n            ]\n          },\n          \"action\": [\n            \"Polishing the curved surface\",\n            \"Carefully applying fresh paint to the globe logo\",\n            \"Cleaning water droplets\"\n          ],\n          \"style\": {\n            \"camera_view\": \"Wide-angle view\",\n            \"technique\": \"Tilt-shift photograph\",\n            \"focus\": \"Shallow depth of field\",\n            \"atmosphere\": \"Warm and cinematic\"\n          },\n          \"parameters\": {\n            \"aspect_ratio\": \"--ar 3:4\",\n            \"reference_constraint\": \" \n          }\n        },\n        {\n          \"id\": 2,\n          \"title\": \"Chanel No.5 Refinery\",\n          \"subject\": {\n            \"main_element\": \"Chanel No.5 perfume bottle\",\n            \"details\": [\n              \"Crystal cap\",\n              \"Label\",\n              \"Tiny scent-mist vapors rising\"\n            ]\n          },\n          \"environment\": {\n            \"setting\": \"Golden mirrored tray\",\n            \"elements\": [\n              \"Scaffolding towers\",\n              \"Dozens of miniature workers in protective suits\"\n            ]\n          },\n          \"action\": [\n            \"Inspecting the crystal cap\",\n            \"Pipetting aromatic fluid\",\n            \"Polishing the label\",\n            \"Sealing the edges\"\n          ],\n          \"style\": {\n            \"camera_view\": \"Wide-angle view\",\n            \"technique\": \"Tilt-shift macro focus\",\n            \"lighting\": \"Elegant lighting with soft gold tones\",\n            \"theme\": \"Highlights glamour and detail\"\n          },\n          \"parameters\": {\n            \"aspect_ratio\": \"--ar 3:4\",\n            \"reference_constraint\": \"\n          }\n        },\n        {\n          \"id\": 3,\n          \"title\": \"Rolex Submariner Restoration\",\n          \"subject\": {\n            \"main_element\": \"Rolex Submariner watch\",\n            \"orientation\": \"Laid flat\",\n            \"details\": [\n              \"Watch face isolated by focus\",\n              \"Golden reflections on edges\"\n            ]\n          },\n          \"environment\": {\n            \"setting\": \"Metal engineer's table\",\n            \"elements\": [\n              \"Mechanical lifts\",\n              \"Magnifying scopes\",\n              \"Scaffolding reaching the crystal top\",\n              \"Miniature technicians\"\n            ]\n          },\n          \"action\": [\n            \"Tightening screws\",\n            \"Replacing bezels\",\n            \"Oiling gears\",\n            \"Aligning the hands\"\n          ],\n          \"style\": {\n            \"camera_view\": \"Wide-angle view\",\n            \"technique\": \"Hyperrealistic tilt-shift macro photography\",\n            \"focus\": \"Shallow depth of field\"\n          },\n          \"parameters\": {\n            \"aspect_ratio\": \"--ar 3:4\",\n            \"reference_constraint\": \"\n          }\n        },\n        {\n          \"id\": 4,\n          \"title\": \"Instant Noodle Construction Site\",\n          \"subject\": {\n            \"main_element\": \"Bowl of instant noodles (halfway eaten)\",\n            \"details\": [\n              \"Foam cup edge\",\n              \"Steam rising\",\n              \"Glowing soup reflections\"\n            ]\n          },\n          \"environment\": {\n            \"setting\": \"Counter\",\n            \"elements\": [\n              \"Cranes lowering new toppings\",\n              \"Scaffolding straddling the rim\",\n              \"Tiny signs warning of 'hot zone'\",\n              \"Miniature workers\"\n            ]\n          },\n          \"action\": [\n            \"Repositioning noodles\",\n            \"Reheating broth\",\n            \"Restacking vegetables\",\n            \"Patching the edge of the foam cup\"\n          ],\n          \"style\": {\n            \"camera_view\": \"Wide-angle view\",\n            \"technique\": \"Highly detailed tilt-shift style\"\n          },\n          \"parameters\": {\n            \"aspect_ratio\": \"--ar 3:4\",\n            \"\n          }\n        }\n      ]\n    }\n    {\n      \"图像生成提示词\": [\n        {\n    \"id\": 1,\n          \"title\": \"百事摩天大楼建设\",\n          \"subject\": {\n            \"main_element\": \"巨大的黑色百事罐\",\n    \"orientation\": \"像摩天大楼一样水平排列\",\n            \"details\": [\n              \"标志性的红、蓝、白设计\",\n              \"表面有闪闪发光的水滴\"\n            ]\n          },\n    \"环境\": {\n            \"设置\": \"格纹的餐厅桌布\",\n    \"elements\": [\n    \"错综复杂的脚手架\"，\n    \"微型建筑工人成群结队\"\n            ]\n          },\n    \"action\": [\n            \"打磨曲面\",\n            \"小心地为地球标志重新涂抹新鲜油漆\",\n    \"清洁水滴\"\n          ],\n          \"style\": {\n            \"camera_view\": \"广角视角\",\n    \"technique\": \"倾斜位移摄影\",\n            \"focus\": \"浅景深\",\n            \"atmosphere\": \"温暖且电影感\"\n          },\n    \"parameters\": {\n            \"aspect_ratio\": \"--ar 3:4\",\n            \"reference_constraint\": \"\n          }\n        },\n        {\n    \"id\": 2,\n          \"title\": \"香奈儿五号精炼版\",\n    \"subject\": {\n            \"main_element\": \"香奈儿五号香水瓶\",\n            \"details\": [\n              \"水晶盖\",\n    \"标签\",\n    \"升腾的微小气味薄雾\"\n            ]\n          },\n    \"环境\": {\n            \"设置\": \"金色镜面托盘\",\n            \"元素\": [\n              \"脚手架塔\",\n    \"几十个穿着防护服的微型工人\"\n            ]\n          },\n          \"action\": [\n    \"检查水晶盖子\",\n            \"滴加芳香液体\",\n            \"抛光标签\",\n            \"密封边缘\"\n    ],\n          \"style\": {\n            \"camera_view\": \"广角视角\",\n            \"technique\": \"倾斜位移微距聚焦\",\n    \"lighting\": \"优雅的照明，带有柔和的金色调\",\n            \"theme\": \"突出奢华和细节\"\n          },\n          \"parameters\": {\n    \"aspect_ratio\": \"--ar 3:4\",\n            \"reference_constraint\": \"\n          }\n        },\n        {\n    \"id\": 3,\n          \"title\": \"劳力士潜航者修复\",\n          \"subject\": {\n    \"main_element\": \"劳力士潜航者手表\",\n            \"orientation\": \"平放\",\n            \"details\": [\n              \"手表表盘聚焦隔离\"\n    \"金色的边缘反射\"\n            ]\n          },\n    \"环境\": {\n    \"setting\": \"金属工人的工作台\",\n            \"elements\": [\n              \"机械升降设备\",\n              \"放大镜\"\n    \"脚手架触及水晶顶部\"，\n    \"微型技师\"\n            ]\n          },\n    \"action\": [\n            \"拧紧螺丝\",\n            \"更换外框\",\n            \"给齿轮上油\",\n    \"对齐双手\"\n          ],\n          \"style\": {\n            \"camera_view\": \"广角视角\",\n    \"technique\": \"超写实移轴微距摄影\",\n            \"focus\": \"浅景深\"\n          },\n          \"parameters\": {\n    \"aspect_ratio\": \"--ar 3:4\",\n            \"reference_constraint\": \"\n          }\n        },\n        {\n    \"id\": 4,\n          \"title\": \"方便面施工现场\",\n          \"subject\": {\n    \"main_element\": \"一碗方便面（吃了一半）\",\n    \"details\": [\n    \"泡沫杯边缘\"，\n    \"蒸汽升腾\"，\n    \"发光的汤的倒影\"\n            ]\n          },\n    \"环境\": {\n    \"setting\": \"计数器\",\n            \"elements\": [\n              \"起重机放下新的配料\",\n              \"脚手架横跨在边缘\"\n    \"警告'高温区'的微小标志\"，\n    \"微型工人\"\n            ]\n          },\n    \"action\": [\n            \"重新摆放面条\",\n            \"重新加热汤底\",\n            \"重新堆叠蔬菜\",\n    \"修补泡沫杯的边缘\"\n          ],\n          \"style\": {\n            \"camera_view\": \"广角视角\",\n    \"technique\": \"高度精细的倾斜变换风格\"\n          },\n          \"parameters\": {\n            \"aspect_ratio\": \"--ar 3:4\",\n            \"\n          }\n        }\n      ]\n    }",
        "images": [
            "assets/prompts/Ai_______3_1.png",
            "assets/prompts/Ai_______3_2.png",
            "assets/prompts/Ai_______3_3.png",
            "assets/prompts/Ai_______3_4.png"
        ],
        "dominantColors": [
            "black",
            "red",
            "orange"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "soda can",
                    "miniature workers",
                    "scaffolding",
                    "ladder",
                    "checkered tablecloth",
                    "water droplets",
                    "paint cans",
                    "condiment bottles",
                    "Pepsi logo",
                    "toy truck"
                ],
                "zh": [
                    "汽水罐",
                    "微缩工人",
                    "脚手架",
                    "梯子",
                    "格子桌布",
                    "水珠",
                    "油漆桶",
                    "调味瓶",
                    "百事可乐标志",
                    "玩具卡车"
                ]
            },
            "scenes": {
                "en": [
                    "diner interior",
                    "indoors",
                    "tabletop",
                    "warm lighting",
                    "construction scene",
                    "urban setting"
                ],
                "zh": [
                    "餐厅内部",
                    "室内",
                    "桌面",
                    "暖色灯光",
                    "施工场景",
                    "城市环境"
                ]
            },
            "styles": {
                "en": [
                    "miniature",
                    "diorama",
                    "surreal",
                    "whimsical",
                    "3D art",
                    "hyperrealistic",
                    "creative photography",
                    "detailed"
                ],
                "zh": [
                    "微缩",
                    "立体模型",
                    "超现实",
                    "奇幻",
                    "3D艺术",
                    "超写实",
                    "创意摄影",
                    "细节丰富"
                ]
            },
            "mood": {
                "en": [
                    "playful",
                    "imaginative",
                    "humorous",
                    "lively",
                    "busy",
                    "intriguing",
                    "lighthearted"
                ],
                "zh": [
                    "俏皮",
                    "富有想象力",
                    "幽默",
                    "生动活泼",
                    "忙碌",
                    "引人入胜",
                    "轻松愉快"
                ]
            }
        }
    },
    {
        "id": "prompt-4",
        "title": "Capture the romance",
        "tags": [
            "Creative"
        ],
        "description": "# Capture the romance\n- Prompt Template\n    Creative botanical art collage depicting [Scene/Activity]. The image is constructed entirely from exquisit...",
        "prompt": "# Capture the romance\n- Prompt Template\n    Creative botanical art collage depicting [Scene/Activity]. The image is constructed entirely from exquisite cut natural leaves, flower petals, plant stems, and wild berries. The silhouettes of figures and objects are formed by the intricate arrangement of these plant elements. The plant surfaces feature a slightly wet, glossy texture adorned with crystal-clear morning dew droplets. Rich, vibrant colors with distinct visual layering. The background is a soft, natural bokeh that harmonizes with the mood of the scene. Macro photography style, hyper-realistic organic textures, 8K resolution, masterpiece.\n    ---\n    Scene：a girl riding a bicycle through a park",
        "images": [
            "assets/prompts/Capture_the_romance_4_1.png",
            "assets/prompts/Capture_the_romance_4_2.png",
            "assets/prompts/Capture_the_romance_4_3.png"
        ],
        "dominantColors": [
            "orange",
            "black",
            "green"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "bicycle",
                    "girl",
                    "leaves",
                    "flowers",
                    "berries",
                    "water droplets",
                    "artwork",
                    "figure",
                    "nature elements",
                    "sculpture"
                ],
                "zh": [
                    "自行车",
                    "女孩",
                    "树叶",
                    "花朵",
                    "浆果",
                    "水滴",
                    "艺术品",
                    "人物",
                    "自然元素",
                    "雕塑"
                ]
            },
            "scenes": {
                "en": [
                    "outdoor",
                    "nature",
                    "garden",
                    "forest",
                    "autumn",
                    "daylight",
                    "natural setting",
                    "greenery"
                ],
                "zh": [
                    "户外",
                    "自然",
                    "花园",
                    "森林",
                    "秋天",
                    "日光",
                    "自然场景",
                    "绿植"
                ]
            },
            "styles": {
                "en": [
                    "leaf art",
                    "nature art",
                    "3D art",
                    "mixed media",
                    "collage",
                    "whimsical",
                    "creative",
                    "handmade",
                    "figurative",
                    "craft"
                ],
                "zh": [
                    "树叶艺术",
                    "自然艺术",
                    "3D艺术",
                    "混合媒体",
                    "拼贴画",
                    "奇幻",
                    "创意",
                    "手工",
                    "具象艺术",
                    "工艺品"
                ]
            },
            "mood": {
                "en": [
                    "peaceful",
                    "whimsical",
                    "dreamy",
                    "joyful",
                    "delicate",
                    "vibrant",
                    "magical",
                    "idyllic",
                    "harmonious"
                ],
                "zh": [
                    "宁静",
                    "奇幻",
                    "梦幻",
                    "欢乐",
                    "精致",
                    "充满活力",
                    "神奇",
                    "田园风光",
                    "和谐"
                ]
            }
        }
    },
    {
        "id": "prompt-5",
        "title": "KDA 风",
        "tags": [
            "3D Art"
        ],
        "description": "# KDA 风\n- \n    LOVE this one bro! Here's my take at it, Taylor Swift concert scene.  Scene prompt: SCENE: Inside a vast open-air stadium at night duri...",
        "prompt": "# KDA 风\n- \n    LOVE this one bro! Here's my take at it, Taylor Swift concert scene.  Scene prompt: SCENE: Inside a vast open-air stadium at night during a high-energy Taylor Swift concert. Tens of thousands of fans fill the stands and floor, illuminated by a sea of synchronized LED wristbands glowing in shifting waves of pink, lavender, and electric blue. The enormous stage stretches outward with towering screens, glittering spotlights, cascading holographic projections, and swirling confetti suspended in midair. Taylor stands center-stage, mid-performance, surrounded by dancers, musicians, and beams of radiant light cutting through the drifting haze. The atmosphere is charged with motion, color, and emotion—an immersive moment where music, crowd energy, and lights merge into a single shimmering spectacle.",
        "images": [
            "assets/prompts/KDA___5_1.png"
        ],
        "dominantColors": [
            "blue",
            "purple",
            "black"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "singer",
                    "audience",
                    "stage",
                    "stadium",
                    "spotlight",
                    "neon lights",
                    "confetti",
                    "microphone",
                    "band",
                    "holographic figures"
                ],
                "zh": [
                    "歌手",
                    "观众",
                    "舞台",
                    "体育场",
                    "聚光灯",
                    "霓虹灯",
                    "五彩纸屑",
                    "麦克风",
                    "乐队",
                    "全息人物"
                ]
            },
            "scenes": {
                "en": [
                    "concert",
                    "live performance",
                    "arena",
                    "night scene",
                    "music festival",
                    "stage show",
                    "large venue",
                    "crowd scene",
                    "event",
                    "nightlife"
                ],
                "zh": [
                    "演唱会",
                    "现场演出",
                    "竞技场",
                    "夜景",
                    "音乐节",
                    "舞台表演",
                    "大型场馆",
                    "人群场景",
                    "活动",
                    "夜生活"
                ]
            },
            "styles": {
                "en": [
                    "3D art",
                    "digital art",
                    "futuristic",
                    "neon art",
                    "holographic",
                    "glowing",
                    "vibrant",
                    "dynamic",
                    "sci-fi",
                    "surreal"
                ],
                "zh": [
                    "3D艺术",
                    "数字艺术",
                    "未来主义",
                    "霓虹艺术",
                    "全息",
                    "发光",
                    "充满活力",
                    "动感",
                    "科幻",
                    "超现实"
                ]
            },
            "mood": {
                "en": [
                    "energetic",
                    "exciting",
                    "euphoric",
                    "festive",
                    "thrilling",
                    "lively",
                    "immersive",
                    "dreamy",
                    "spectacular",
                    "celebratory"
                ],
                "zh": [
                    "充满活力",
                    "激动人心",
                    "狂喜",
                    "欢快",
                    "令人兴奋",
                    "活泼",
                    "身临其境",
                    "梦幻",
                    "壮观",
                    "庆祝的"
                ]
            }
        }
    },
    {
        "id": "prompt-6",
        "title": "Q 版履行手账",
        "tags": [
            "Illustration"
        ],
        "description": "# Q 版履行手账\n- prompt\n    lease create a vibrant, child-like crayon-style vertical (9:16) illustration titled “{City Name} Travel Journal.”  \n    The art...",
        "prompt": "# Q 版履行手账\n- prompt\n    lease create a vibrant, child-like crayon-style vertical (9:16) illustration titled “{City Name} Travel Journal.”  \n    The artwork should look as if it were drawn by a curious child using colorful crayons, featuring a soft, warm light-toned background (such as pale yellow), combined with bright reds, blues, greens, and other cheerful colors to create a cozy, playful travel atmosphere.\n    I. Main Scene: Travel-Journal Style Route Map\n    In the center of the illustration, draw a “winding, zigzagging travel route” with arrows and dotted lines connecting multiple locations.  \n    The route should automatically generate recommended attractions based on {Number of Days}:\n    Example structure (auto-filled with {City Name}-related content):\n    - “Stop 1: {Attraction 1 + short fun description}”\n    - “Stop 2: {Attraction 2 + short fun description}”\n    - “Stop 3: {Attraction 3 + short fun description}”\n    - …\n    - “Final Stop: {Local signature food or souvenir + warm closing remark}”\n    Rules:\n    - If no number of days is provided, default to a 1-day highlight itinerary.\n    II. Surrounding Playful Elements (Auto-adapt to the City)\n    Add many cute doodles and child-like decorative elements around the route, such as:\n    1. Adorable travel characters\n       - A child holding a local snack  \n       - A little adventurer with a backpack\n    2. Q-style hand-drawn iconic landmarks\n       - “{City Landmark 1}”\n       - “{City Landmark 2}”\n       - “{City Landmark 3}”\n    3. Funny signboards\n       - “Don’t get lost!”\n       - “Crowds ahead!”\n       - “Yummy food this way!”  \n       (Auto-adjust contextually for the city)\n    4. Sticker-style short phrases\n       - “{City Name} travel memories unlocked!”\n       - “{City Name} food adventure!”\n       - “Where to next?”\n    5. Cute icons of local foods\n       - “{Local Food 1}”\n       - “{Local Food 2}”\n       - “{Local Food 3}”\n    6. Childlike exclamations\n       - “I didn’t know {City Name} was so fun!”\n       - “I want to come again!”\n    III. Overall Art Style Requirements\n    - Crayon / children’s hand-drawn travel diary style\n    - Bright, warm, colorful palette\n    - Cozy but full and lively composition\n    - Emphasize the joy of exploring\n    - All text should be in a cute handwritten font\n    - Make the entire page feel like a young child’s fun travel-journal entry\n    - --\n    Input :\n    Chicago 7-Day Trip, English",
        "images": [
            "assets/prompts/Q_______6_1.png",
            "assets/prompts/Q_______6_2.png"
        ],
        "dominantColors": [
            "yellow",
            "orange",
            "gray"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "child",
                    "backpack",
                    "camera",
                    "traditional architecture",
                    "Great Wall",
                    "boat",
                    "panda",
                    "Peking duck",
                    "noodles",
                    "tanghulu"
                ],
                "zh": [
                    "小孩",
                    "背包",
                    "相机",
                    "传统建筑",
                    "长城",
                    "船",
                    "熊猫",
                    "北京烤鸭",
                    "面条",
                    "糖葫芦"
                ]
            },
            "scenes": {
                "en": [
                    "Beijing",
                    "historic site",
                    "city street",
                    "hutong",
                    "park",
                    "zoo",
                    "outdoor",
                    "tourism",
                    "restaurant",
                    "lake"
                ],
                "zh": [
                    "北京",
                    "历史遗迹",
                    "城市街道",
                    "胡同",
                    "公园",
                    "动物园",
                    "户外",
                    "旅游",
                    "餐厅",
                    "湖泊"
                ]
            },
            "styles": {
                "en": [
                    "cartoon",
                    "illustration",
                    "hand-drawn",
                    "cute",
                    "infographic",
                    "travel guide",
                    "bright colors",
                    "simple",
                    "educational",
                    "whimsical"
                ],
                "zh": [
                    "卡通",
                    "插画",
                    "手绘",
                    "可爱",
                    "信息图",
                    "旅行指南",
                    "色彩鲜艳",
                    "简洁",
                    "教育性",
                    "奇趣"
                ]
            },
            "mood": {
                "en": [
                    "joyful",
                    "adventurous",
                    "lively",
                    "childlike",
                    "optimistic",
                    "friendly",
                    "curious",
                    "exciting",
                    "relaxing",
                    "memorable"
                ],
                "zh": [
                    "欢乐",
                    "冒险",
                    "活泼",
                    "童真",
                    "乐观",
                    "友好",
                    "好奇",
                    "令人兴奋",
                    "轻松",
                    "难忘"
                ]
            }
        }
    },
    {
        "id": "prompt-7",
        "title": "Small body, Lion heart",
        "tags": [
            "Photography"
        ],
        "description": "# Small body, Lion heart.\n- Prompt Template\n    prompt: A small, reddish-brown poodle with curly fur and expressive dark eyes is standing on a quiet s...",
        "prompt": "# Small body, Lion heart.\n- Prompt Template\n    prompt: A small, reddish-brown poodle with curly fur and expressive dark eyes is standing on a quiet street, looking into a puddle. In the water’s reflection, he sees a proud, majestic lion with a flowing mane. The reflection is realistically distorted by soft ripples in the puddle, giving the scene a dreamlike, metaphorical quality. The lighting is soft and natural, with a hint of golden hour. The image captures the contrast between Vin’s small size and his inner strength, courage, and determination. --ar 1:1",
        "images": [
            "assets/prompts/Small_body__Lion_heart_7_1.png"
        ],
        "dominantColors": [
            "brown",
            "black",
            "orange"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "dog",
                    "lion",
                    "puddle",
                    "leaves",
                    "cobblestone",
                    "building",
                    "reflection",
                    "water"
                ],
                "zh": [
                    "狗",
                    "狮子",
                    "水坑",
                    "树叶",
                    "鹅卵石",
                    "建筑",
                    "倒影",
                    "水"
                ]
            },
            "scenes": {
                "en": [
                    "street",
                    "old town",
                    "outdoor",
                    "autumn",
                    "wet ground",
                    "golden hour",
                    "urban setting",
                    "after rain"
                ],
                "zh": [
                    "街道",
                    "老城",
                    "户外",
                    "秋天",
                    "潮湿地面",
                    "黄金时段",
                    "城市环境",
                    "雨后"
                ]
            },
            "styles": {
                "en": [
                    "surrealism",
                    "creative photography",
                    "reflection photography",
                    "photo manipulation",
                    "warm lighting",
                    "animal photography",
                    "fantasy",
                    "magical realism"
                ],
                "zh": [
                    "超现实主义",
                    "创意摄影",
                    "倒影摄影",
                    "照片处理",
                    "暖光",
                    "动物摄影",
                    "奇幻",
                    "魔幻现实主义"
                ]
            },
            "mood": {
                "en": [
                    "magical",
                    "whimsical",
                    "mysterious",
                    "dreamy",
                    "thought-provoking",
                    "inspiring",
                    "empowering",
                    "brave"
                ],
                "zh": [
                    "神奇",
                    "异想天开",
                    "神秘",
                    "梦幻",
                    "引人深思",
                    "鼓舞人心",
                    "赋能",
                    "勇敢"
                ]
            }
        }
    },
    {
        "id": "prompt-8",
        "title": "children's book",
        "tags": [
            "Illustration"
        ],
        "description": "# children's book\n- Prompt Template\n    Double page spread illustration for a children's book.\n    A sprawling, vibrant, chaotic landscape filling bot...",
        "prompt": "# children's book\n- Prompt Template\n    Double page spread illustration for a children's book.\n    A sprawling, vibrant, chaotic landscape filling both pages. Tim and Sora are in the center, painting together actively. The world is full of funny \"mistakes\": houses built of gigantic fruits, clouds shaped like teapots raining lemonade, animals with mismatched body parts playing happily, flowers with smiling faces. Everything is colorful, messy, imperfect, but joyful.\n    Text across the top in playful font: \"And so, they drew a messy, wonderfully happy world together.\"\n    Style: Whimsical watercolor and crayon texture, explosion of color and imagination, detailed and full of life.\n    --ar 4:3",
        "images": [
            "assets/prompts/children_s_book_8_1.png"
        ],
        "dominantColors": [
            "white",
            "gray",
            "yellow"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "boy",
                    "paintbrush",
                    "crayons",
                    "flowers",
                    "animals",
                    "elephant",
                    "giraffe",
                    "house",
                    "fruit",
                    "cloud"
                ],
                "zh": [
                    "男孩",
                    "画笔",
                    "蜡笔",
                    "花朵",
                    "动物",
                    "大象",
                    "长颈鹿",
                    "房子",
                    "水果",
                    "云朵"
                ]
            },
            "scenes": {
                "en": [
                    "fantasy world",
                    "outdoor",
                    "garden",
                    "fairytale scene",
                    "imaginary landscape",
                    "dreamland"
                ],
                "zh": [
                    "奇幻世界",
                    "户外",
                    "花园",
                    "童话场景",
                    "想象景观",
                    "梦幻世界"
                ]
            },
            "styles": {
                "en": [
                    "children's illustration",
                    "watercolor",
                    "cartoon style",
                    "colorful",
                    "whimsical",
                    "hand-drawn",
                    "bright colors"
                ],
                "zh": [
                    "儿童插画",
                    "水彩画",
                    "卡通风格",
                    "多彩",
                    "奇幻",
                    "手绘",
                    "鲜艳色彩"
                ]
            },
            "mood": {
                "en": [
                    "happy",
                    "joyful",
                    "playful",
                    "creative",
                    "imaginative",
                    "whimsical",
                    "cheerful"
                ],
                "zh": [
                    "快乐",
                    "欢快",
                    "活泼",
                    "创意",
                    "富有想象力",
                    "奇幻",
                    "愉悦"
                ]
            }
        }
    },
    {
        "id": "prompt-9",
        "title": "一叶一世界",
        "tags": [
            "Miniature"
        ],
        "description": "# 一叶一世界\n- 图一提示词\n    A hyper-detailed digital painting of a single, intact autumn maple leaf suspended in soft spring afternoon light. The leaf is intr...",
        "prompt": "# 一叶一世界\n- 图一提示词\n    A hyper-detailed digital painting of a single, intact autumn maple leaf suspended in soft spring afternoon light. The leaf is intricately laser-cut with an exquisite micro-scene: a couple standing beneath a blooming cherry blossom tree, petals floating mid-air. The cut-out areas reveal a dreamy, shallow-depth-of-field garden background bathed in golden-hour diffused sunlight.\n    On the remaining leaf surface, translucent dewdrops glisten like liquid pearls— one perfectly spherical drop clings to the edge, capturing a miniature reflection of the entire scene; another trails a delicate, shimmering water streak as it begins to fall.\n    The leaf exhibits rich 3D texture: veins act as natural contours, and the paper-thin cutouts create subtle shadows that enhance depth. Lighting is cinematic—soft, directional, warm—casting gentle gradients across the leaf’s organic topography.\n    Style: fusion of 18th-century botanical illustration precision + contemporary hyperrealism + film still aesthetic (reminiscent of Wong Kar-wai or Sofia Coppola). Color palette: amber reds, blush pinks, creamy golds, and soft greens. Mood: tender, ephemeral, poetic, quietly romantic.\n    Background: bokeh of sun-dappled cherry trees and hazy spring foliage, ground rendered as a reflective water-mirror surface echoing the leaf and sky. Composition centered, macro lens perspective, ultra-high resolution, 8k.\n    图一提示词：一幅超精细的数字绘画，描绘了一片完整无损的秋枫叶，悬浮在柔和的春日午后光线中。叶片经过复杂激光切割，呈现出精致微缩场景：一对情侣站在盛开的樱花树下，花瓣在空中飘浮。切割区域展现出一个梦幻般的浅景深花园背景，沐浴在黄金时刻的柔光中。\n    在剩余的叶片表面，半透明的露珠像液态珍珠般闪烁——一滴完美球形的水珠附着在边缘，捕捉了整个场景的微型倒影；另一滴则留下一条精致闪烁的水痕，开始滑落。\n    叶片展现出丰富的 3D 纹理：叶脉作为自然轮廓，纸薄的切割区域创造出微妙阴影，增强了深度。光影具有电影感——柔和、定向、温暖，在叶片的自然地形上投下柔和的渐变。\n    风格：融合 18 世纪植物插图精确度+当代超写实主义+电影剧照美学（让人联想到王家卫或索菲亚·科波拉）。色彩搭配：琥珀红色、淡粉色、奶油金色和柔和的绿色。氛围：温柔、短暂、诗意、静谧浪漫。\n    背景：阳光斑驳的樱花树和朦胧的春日叶丛，地面呈现为反射水面，映照出叶子和天空。构图居中，微距镜头视角，超高清分辨率，8k。\n- 图二提示词\n    English Prompt (Optimized):\n    A hyper-detailed digital painting of a single, intact autumn maple leaf suspended in soft spring afternoon light. The leaf is intricately laser-cut with an exquisite micro-scene: the delicate facial profile of Audrey Hepburn—capturing her iconic arched eyebrows, almond eyes, refined nose, and gentle chin—but rendered entirely in harmonious autumnal tones that echo the leaf itself: warm amber reds for subtle contouring, blush pinks for her lips and cheeks, creamy golds for highlights on her skin, and faint olive-greens in the shadows to mirror the leaf’s organic undertones. Her upswept hair blends seamlessly into the leaf’s veins, as if grown from its fibers.\n    She stands beneath a blooming cherry blossom tree within the cut-out, petals floating mid-air around her. The negative space reveals a dreamy, shallow-depth-of-field garden background bathed in golden-hour diffused sunlight.\n    On the remaining leaf surface, translucent dewdrops glisten like liquid pearls—one perfectly spherical drop clings to the edge, capturing a miniature reflection of Hepburn’s face and the cherry blossoms; another trails a delicate, shimmering water streak as it begins to fall.\n    The leaf exhibits rich 3D texture: raised veins act as natural contours, and the paper-thin laser-cut areas cast soft, dimensional shadows that enhance depth. Lighting is cinematic—soft, directional, warm—casting luminous gradients across the leaf’s topography.\n    Style: fusion of 18th-century botanical illustration precision + contemporary hyperrealism + film still aesthetic (reminiscent of Wong Kar-wai’s color poetry or Sofia Coppola’s tender nostalgia).\n    图二提示词：\n    英文提示词（优化版）：\n    一幅超精细的数字绘画，展示一片完整的秋日枫叶，悬挂在柔和的春日午后阳光下。这片枫叶经过精密的激光切割，呈现出精致微缩场景：奥黛丽·赫本的精致面部轮廓——捕捉她标志性的拱形眉毛、杏仁眼、精致鼻子和温柔下巴——但完全以和谐的秋日色调呈现，与枫叶本身相呼应：温暖的琥珀红色用于微妙轮廓，淡粉色用于她的嘴唇和脸颊，奶油金色用于皮肤上的高光，以及淡淡的橄榄绿色用于阴影，以映衬枫叶的自然底色。她的向上卷曲的头发与枫叶的叶脉无缝融合，仿佛从其纤维中生长出来。\n    她站在切割出的樱花树花下，花瓣在空中围绕着她飘落。负空间揭示了一个梦幻般的浅景深花园背景，沐浴在黄金时刻的柔光中。\n    在剩余的叶面上，半透明的露珠像液态珍珠般闪耀——一滴完美的球形露珠挂在边缘，捕捉了赫本的脸庞和樱花的小幅倒影；另一滴则开始坠落，留下一条精致、闪烁的水痕。\n    叶片展现出丰富的 3D 纹理：凸起的叶脉形成自然轮廓，纸薄的激光切割区域投下柔和的立体阴影，增强了深度。光线具有电影感——柔和、定向、温暖——在叶片的地形上投下明亮的光影渐变。\n    风格：18 世纪植物插图精确性 + 当代超写实主义 + 电影剧照美学（让人联想到王家卫的色彩诗意或索菲亚·科波拉的温柔怀旧）。\n    Color palette: amber reds, blush pinks, creamy golds, soft mossy greens—no stark whites or cool tones.\n    色彩搭配：琥珀红色、淡粉色、奶油金色、柔和的苔藓绿色——没有刺眼的白色或冷色调。\n    Mood: tender, ephemeral, poetic, quietly romantic, steeped in wistful memory.\n    Background: bokeh of sun-dappled cherry trees and hazy spring foliage; ground rendered as a reflective water-mirror surface, softly echoing the leaf, sky, and Hepburn’s silhouette.\n    情绪：温柔、短暂、诗意、静谧浪漫、充满怀旧回忆。\n    背景：阳光斑驳的樱花树和朦胧的春叶；地面呈现为反射水面，柔和地映照出树叶、天空和赫本的身影。\n    Composition: centered, macro lens perspective, ultra-high resolution, 8K.\n    构图：居中，微距镜头视角，超高清，8K。\n- 一叶一世界\n    以树叶剪纸艺术为灵感，通过精巧的镂空手法在一片完整的【叶子类型，可选，默认绿叶】上，表现【场景详细描述】。\n    所有元素之间均以自然的有机叶脉结构连接，无任何孤立漂浮的部分。\n    叶片表面呈现湿润光泽质感，点缀微小晶莹水滴，阳光柔和投射，形成自然柔和的高光与阴影效果。\n    背景采用柔和虚化的自然景观，体现自然静谧的氛围，8K超高清分辨率，细节丰富且真实细腻。\n    （可选动态元素：轻盈飘落的蒲公英绒毛、缓慢滑落的小水滴）\nFrome：[@dotey](https://x.com/dotey)",
        "images": [
            "assets/prompts/______9_1.png",
            "assets/prompts/______9_2.png",
            "assets/prompts/______9_3.png"
        ],
        "dominantColors": [
            "orange",
            "gray"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "maple leaf",
                    "couple",
                    "cherry blossoms",
                    "tree",
                    "water droplets",
                    "flower petals",
                    "silhouette"
                ],
                "zh": [
                    "枫叶",
                    "情侣",
                    "樱花",
                    "树",
                    "水滴",
                    "花瓣",
                    "剪影"
                ]
            },
            "scenes": {
                "en": [
                    "outdoor",
                    "nature",
                    "garden",
                    "pond",
                    "spring",
                    "sunset",
                    "reflections",
                    "golden hour"
                ],
                "zh": [
                    "户外",
                    "自然",
                    "花园",
                    "池塘",
                    "春天",
                    "日落",
                    "倒影",
                    "黄金时段"
                ]
            },
            "styles": {
                "en": [
                    "3D art",
                    "digital art",
                    "silhouette art",
                    "whimsical",
                    "dreamy",
                    "surreal",
                    "colorful",
                    "fantasy art",
                    "photorealistic",
                    "illustrative"
                ],
                "zh": [
                    "3D艺术",
                    "数字艺术",
                    "剪影艺术",
                    "奇幻",
                    "梦幻",
                    "超现实",
                    "多彩",
                    "幻想艺术",
                    "照片写实",
                    "插画风"
                ]
            },
            "mood": {
                "en": [
                    "romantic",
                    "peaceful",
                    "dreamy",
                    "loving",
                    "serene",
                    "magical",
                    "joyful",
                    "hopeful"
                ],
                "zh": [
                    "浪漫",
                    "宁静",
                    "梦幻",
                    "有爱",
                    "平静",
                    "神奇",
                    "欢快",
                    "充满希望"
                ]
            }
        }
    },
    {
        "id": "prompt-10",
        "title": "冷暖对比风",
        "tags": [
            "Creative"
        ],
        "description": "# 冷暖对比风\n- -- Prompt ---\n    - \n    A horizontal split-screen cinematic shot of {Scene}, seamlessly blending two different eras: {Era_A} on the left an...",
        "prompt": "# 冷暖对比风\n- -- Prompt ---\n    - \n    A horizontal split-screen cinematic shot of {Scene}, seamlessly blending two different eras: {Era_A} on the left and {Era_B} on the right (default: about 100 years ago vs. present day).\n    On the left side ({Era_A}): show era-appropriate architecture, interior or environment design, materials, vehicles, and props that clearly belong to that historical period. People wear authentic clothing from {Era_A}, including hairstyles, accessories, and typical items in their hands (such as books, umbrellas, instruments, letters, newspapers, etc.). The overall mood feels nostalgic and historically accurate.\n    On the right side ({Era_B}): show the same {Scene} in the modern era, with updated architecture or renovated structures, contemporary materials (glass, steel, LED screens, modern furniture), modern vehicles or equipment, and current technology (smartphones, laptops, cameras, etc.). People wear contemporary fashion that matches today’s style in this setting.\n    In the center: the two eras merge and overlap organically, without a hard dividing line. Elements from {Era_A} and {Era_B} visually interact: people from different times look at each other, walk through each other’s space, or seem surprised by the other era’s technology and objects. Architecture and environment smoothly morph from old to new (for example, stone gates turning into modern campus gates, classical concert hall décor fading into a futuristic stage, old street shops transforming into neon-lit storefronts).\n    Make sure the scene is not just a simple left/right comparison but a dynamic time-travel interaction where buildings, clothing, props, and human gestures clearly emphasize the contrast and fusion between the two eras. Photorealistic, 8k resolution, cinematic lighting, wide angle, highly detailed textures, rich sense of time-travel storytelling.\n    ---\n    SCENE: Times Square, New York\n    Era Comparison: 1920s and present day\n    Aspect Ratio: 4:3",
        "images": [
            "assets/prompts/______10_1.png"
        ],
        "dominantColors": [
            "gray",
            "orange",
            "blue"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "people",
                    "man",
                    "woman",
                    "vintage car",
                    "modern car",
                    "billboard",
                    "digital billboard",
                    "building",
                    "theater",
                    "streetcar"
                ],
                "zh": [
                    "人群",
                    "男人",
                    "女人",
                    "老爷车",
                    "现代汽车",
                    "广告牌",
                    "数字广告牌",
                    "建筑",
                    "剧院",
                    "有轨电车"
                ]
            },
            "scenes": {
                "en": [
                    "city street",
                    "urban",
                    "Times Square",
                    "dusk",
                    "outdoor",
                    "bustling street",
                    "street scene",
                    "road",
                    "sidewalk"
                ],
                "zh": [
                    "城市街道",
                    "都市",
                    "时代广场",
                    "黄昏",
                    "户外",
                    "繁忙街道",
                    "街景",
                    "道路",
                    "人行道"
                ]
            },
            "styles": {
                "en": [
                    "photorealistic",
                    "time blend",
                    "surreal",
                    "cinematic",
                    "retro-futurism",
                    "juxtaposition",
                    "realistic",
                    "mixed eras"
                ],
                "zh": [
                    "超写实",
                    "时代融合",
                    "超现实",
                    "电影感",
                    "复古未来主义",
                    "并置",
                    "写实",
                    "时代混搭"
                ]
            },
            "mood": {
                "en": [
                    "vibrant",
                    "lively",
                    "energetic",
                    "busy",
                    "nostalgic",
                    "modern",
                    "contrasting",
                    "dynamic",
                    "exciting",
                    "futuristic"
                ],
                "zh": [
                    "充满活力",
                    "活泼",
                    "精力充沛",
                    "忙碌",
                    "怀旧",
                    "现代",
                    "对比鲜明",
                    "动态",
                    "激动人心",
                    "未来感"
                ]
            }
        }
    },
    {
        "id": "prompt-11",
        "title": "包装 封面设计",
        "tags": [
            "Creative"
        ],
        "description": "# 包装/封面设计\n- Prompt Template\n    服装/奶茶/面包】品牌包装设计展示图，一张完整设计稿画面，【总体风格描述，纯黑色包装袋，简约Logo设计，具有质感的材质………】，【需融入形象】……\n    画面中同时展示：\n    •【服装】包装袋设计和吊牌设计\n    •左侧为黑色...",
        "prompt": "# 包装/封面设计\n- Prompt Template\n    服装/奶茶/面包】品牌包装设计展示图，一张完整设计稿画面，【总体风格描述，纯黑色包装袋，简约Logo设计，具有质感的材质………】，【需融入形象】……\n    画面中同时展示：\n    •【服装】包装袋设计和吊牌设计\n    •左侧为黑色线稿结构图（线描风格，工业设计草图）\n    •右侧为完成上色的成品效果图（真实材质质感）\n    •下方或角落配有简洁的设计标注文字（尺寸、材质、工艺说明，示意性）\n    整体风格为专业包装设计提案，【干净白色】背景，平面排版清晰\n    设计感强，理性、有秩序\n    非广告海报风格\n    视角为正视图 + 轻微等轴测视角\n    高分辨率，细节清晰",
        "images": [
            "assets/prompts/________11_1.png",
            "assets/prompts/________11_2.png",
            "assets/prompts/________11_3.png",
            "assets/prompts/________11_4.png"
        ],
        "dominantColors": [
            "gray"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "packaging bag",
                    "kraft paper bag",
                    "cat",
                    "pastry",
                    "sticker",
                    "logo",
                    "PET window",
                    "design diagram",
                    "chef's hat",
                    "food packaging"
                ],
                "zh": [
                    "包装袋",
                    "牛皮纸袋",
                    "猫",
                    "糕点",
                    "贴纸",
                    "标志",
                    "PET窗口",
                    "设计图",
                    "厨师帽",
                    "食品包装"
                ]
            },
            "scenes": {
                "en": [
                    "studio shot",
                    "product photography",
                    "white background",
                    "commercial setting",
                    "indoor"
                ],
                "zh": [
                    "工作室拍摄",
                    "产品摄影",
                    "白色背景",
                    "商业场景",
                    "室内"
                ]
            },
            "styles": {
                "en": [
                    "packaging design",
                    "minimalist design",
                    "cute style",
                    "modern design",
                    "clean aesthetic",
                    "product mockup",
                    "branding",
                    "infographic",
                    "realistic rendering"
                ],
                "zh": [
                    "包装设计",
                    "极简设计",
                    "可爱风格",
                    "现代设计",
                    "简洁美学",
                    "产品样机",
                    "品牌设计",
                    "信息图表",
                    "写实渲染"
                ]
            },
            "mood": {
                "en": [
                    "playful",
                    "professional",
                    "cute",
                    "friendly",
                    "appetizing",
                    "creative",
                    "clean"
                ],
                "zh": [
                    "俏皮",
                    "专业",
                    "可爱",
                    "友好",
                    "开胃",
                    "创意",
                    "整洁"
                ]
            }
        }
    },
    {
        "id": "prompt-12",
        "title": "历史画卷",
        "tags": [
            "Creative"
        ],
        "description": "# 历史画卷",
        "prompt": "# 历史画卷",
        "images": [
            "assets/prompts/_____12_1.png",
            "assets/prompts/_____12_2.png"
        ],
        "dominantColors": [
            "brown",
            "orange",
            "gray"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "scroll",
                    "miniature city",
                    "Chinese architecture",
                    "Forbidden City",
                    "Temple of Heaven",
                    "Great Wall",
                    "mountains",
                    "trees",
                    "people",
                    "wooden table"
                ],
                "zh": [
                    "画卷",
                    "微缩城市",
                    "中国建筑",
                    "故宫",
                    "天坛",
                    "长城",
                    "山脉",
                    "树木",
                    "人物",
                    "木桌"
                ]
            },
            "scenes": {
                "en": [
                    "indoor",
                    "ancient city",
                    "mountain landscape",
                    "historical site",
                    "cultural heritage",
                    "traditional Chinese setting",
                    "misty mountains",
                    "bird's-eye view",
                    "study room",
                    "desk scene"
                ],
                "zh": [
                    "室内",
                    "古城",
                    "山水画",
                    "历史遗迹",
                    "文化遗产",
                    "中国传统场景",
                    "雾山",
                    "鸟瞰图",
                    "书房",
                    "案头场景"
                ]
            },
            "styles": {
                "en": [
                    "3D art",
                    "miniature",
                    "isometric view",
                    "traditional Chinese painting",
                    "digital art",
                    "detailed",
                    "realistic",
                    "diorama",
                    "classical",
                    "architectural model"
                ],
                "zh": [
                    "3D艺术",
                    "微缩",
                    "等轴视角",
                    "中国山水画",
                    "数字艺术",
                    "精致",
                    "写实",
                    "立体模型",
                    "古典",
                    "建筑模型"
                ]
            },
            "mood": {
                "en": [
                    "historical",
                    "grand",
                    "serene",
                    "artistic",
                    "intricate",
                    "reverent",
                    "nostalgic",
                    "contemplative",
                    "majestic",
                    "cultural"
                ],
                "zh": [
                    "历史感",
                    "宏伟",
                    "宁静",
                    "艺术性",
                    "精巧",
                    "庄重",
                    "怀旧",
                    "沉思",
                    "雄伟",
                    "文化气息"
                ]
            }
        }
    },
    {
        "id": "prompt-13",
        "title": "古今融合",
        "tags": [
            "Illustration"
        ],
        "description": "# 古今融合\n- prompt\n    A traditional Chinese ink and color painting in Gongbi style on aged rice paper texture. A noblewoman in elaborate Tang Dynasty Ha...",
        "prompt": "# 古今融合\n- prompt\n    A traditional Chinese ink and color painting in Gongbi style on aged rice paper texture. A noblewoman in elaborate Tang Dynasty Hanfu robes sits on a wooden stool, holding a modern hairdryer to dry her long flowing hair. She is wearing black stockings, red high heels on one foot, resting on a small stool.\n    Three Minions dressed in ancient Chinese servant robes and hats attend to her: one on the left looks stressed holding the hairdryer's power cord, one center kneels polishing her red shoe with a cloth, and one on the right holds up a smartphone taking a photo for her. The background features classical gnarled pine trees, bamboo groves, and Taihu rocks.\n    Traditional Chinese calligraphy written in the top right corner, accompanied by a red artist chop seal (寶玉). The color palette is muted mineral pigments. Humorous, anachronistic fusion. --ar 16:9",
        "images": [
            "assets/prompts/_____13_1.png",
            "assets/prompts/_____13_2.png"
        ],
        "dominantColors": [
            "gray",
            "black"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "castle",
                    "bridge",
                    "buildings",
                    "cliffs",
                    "river",
                    "waterfalls",
                    "clouds",
                    "trees",
                    "island",
                    "mountains"
                ],
                "zh": [
                    "城堡",
                    "桥梁",
                    "建筑",
                    "悬崖",
                    "河流",
                    "瀑布",
                    "云朵",
                    "树木",
                    "岛屿",
                    "山脉"
                ]
            },
            "scenes": {
                "en": [
                    "floating island",
                    "sky",
                    "cloudscape",
                    "fantasy landscape",
                    "United Kingdom",
                    "outdoors",
                    "nature",
                    "aerial view",
                    "panoramic",
                    "imaginary world"
                ],
                "zh": [
                    "浮岛",
                    "天空",
                    "云海",
                    "奇幻景观",
                    "英国",
                    "户外",
                    "自然",
                    "航拍视角",
                    "全景",
                    "想象世界"
                ]
            },
            "styles": {
                "en": [
                    "digital art",
                    "photo manipulation",
                    "fantasy art",
                    "surrealism",
                    "detailed",
                    "photorealistic",
                    "conceptual art",
                    "matte painting",
                    "epic",
                    "artistic composition"
                ],
                "zh": [
                    "数字艺术",
                    "图像合成",
                    "奇幻艺术",
                    "超现实主义",
                    "细节丰富",
                    "照片般逼真",
                    "概念艺术",
                    "背景绘画",
                    "史诗",
                    "艺术构图"
                ]
            },
            "mood": {
                "en": [
                    "majestic",
                    "dreamlike",
                    "mysterious",
                    "awe-inspiring",
                    "fantastical",
                    "peaceful",
                    "grand",
                    "ethereal",
                    "wondrous",
                    "evocative"
                ],
                "zh": [
                    "雄伟",
                    "梦幻",
                    "神秘",
                    "令人惊叹",
                    "奇幻",
                    "宁静",
                    "宏伟",
                    "飘渺",
                    "奇妙",
                    "引人联想"
                ]
            }
        }
    },
    {
        "id": "prompt-14",
        "title": "可口可乐",
        "tags": [
            "Photography"
        ],
        "description": "# 可口可乐\n- 提示词\n    Prompt:提示：{\n      \"image_generation_manifest\": {\n        \"meta_directives\": {\n          \"visual_target\": {\n            \"instruction\":...",
        "prompt": "# 可口可乐\n- 提示词\n    Prompt:提示：{\n      \"image_generation_manifest\": {\n        \"meta_directives\": {\n          \"visual_target\": {\n            \"instruction\": \"Exact replication of the provided reference image style and composition.\",\n            \"priority\": \"Highest\"\n          },\n          \"output_format\": {\n            \"aspect_ratio\": \"9:16 (Vertical)\",\n            \"resolution\": \"4K\",\n            \"aesthetic\": \"Hyper-realistic cinematic product photography\"\n          }\n        },\n        \"primary_subject\": {\n          \"product_identity\": {\n            \"brand\": \"Fanta\",\n            \"flavor\": \"Orange  \",\n            \"container\": \"Classic 330 ml aluminum can\",\n            \"finish\": \"Matte-finish aluminum\"\n          },\n          \"positional_state\": {\n            \"physics\": \"Suspended in mid-air, weightless, no supports.\",\n            \"orientation\": \"Logo centered and sharp.\"\n          },\n          \"condition_details\": {\n            \"temperature\": \"Ice-cold\",\n            \"surface_effects\": {\n              \"condensation\": \"Dense coverage of ultra-fine droplets, organic streaks, and crystal-clear refractions.\",\n              \"atmosphere\": \"Subtle chill misting and light diffusion around the edges suggesting weight.\"\n            }\n          }\n        },\n        \"dynamic_environment\": {\n          \"foreground_activity\": {\n            \"organic_elements\": \"Fine plant hairs and upward-stretching vines.\",\n            \"moisture_dynamics\": \"Moisture droplets beading and dripping from fine plant hairs mid-air.\",\n            \"light_dynamics\": [\n              \"Faint ember-like pulses within some vines, alive with warmth.\",\n              \"Vines glow subtly like lava-veined roots due to rim lighting.\"\n            ]\n          },\n          \"background_context\": {\n            \"scenery\": \"Blurred silhouette of an overgrown infernal forest or deep alien undergrowth.\",\n            \"atmospheric_conditions\": \"Obscured in fog and cinematic haze.\",\n            \"mood_indicators\": \"Pulses with heat and shadow, suggesting tension and drama.\"\n          }\n        },\n        \"cinematography_specs\": {\n          \"optical_configuration\": {\n            \"lens\": \"100 mm Macro\",\n            \"aperture\": \"f/8\",\n            \"depth_of_field\": \"Shallow\"\n          },\n          \"focus_map\": {\n            \"sharp_plane\": [\"Fanta Logo\", \"Can Condensation\", \"Closest Vine Textures\"],\n            \"blur_plane\": [\"Background melting into smooth atmospheric bokeh\"]\n          },\n          \"composition_rules\": {\n            \"framing\": \"Frontal cinematic close-up with slight upward angle (Heroic Framing).\",\n            \"layout\": \"Negative space below the can with vines stretching upward.\",\n            \"intent\": \"Emphasize scale and impact without overpowering the subject.\"\n          }\n        },\n        \"lighting_design\": {\n          \"scheme\": \"Dual-tone rim setup\",\n          \"sources\": {\n            \"key_left\": {\n              \"color_temp\": \"Cool white (~5600 K)\",\n              \"purpose\": \"Accentuate metallic highlights and water beads.\"\n            },\n            \"rim_right\": {\n              \"color_tone\": \"Deep red-orange\",\n              \"purpose\": \"Create lava-veined root glow effect on vines.\"\n            }\n          }\n        }\n      }\n    }{\n      \"image_generation_manifest\": {\n    \"meta_directives\": {\n          \"visual_target\": {\n            \"instruction\": \"精确复刻提供的参考图像的风格和构图。\",\n            \"priority\": \"最高\"\n          },\n    \"output_format\": {\n            \"aspect_ratio\": \"9:16 (竖屏)\",\n            \"resolution\": \"4K\",\n    \"aesthetic\": \"超写实的电影级产品摄影\"\n          }\n        },\n        \"primary_subject\": {\n    \"product_identity\": {\n            \"brand\": \"Fanta\",\n            \"flavor\": \"Orange  \",\n            \"container\": \"Classic 330 ml aluminum can\",\n    \"finish\": \"哑光铝\"\n          },\n          \"positional_state\": {\n            \"physics\": \"悬浮在空中，无重量，无支撑。\",\n    \"orientation\": \"标志居中且清晰。\"\n          },\n          \"condition_details\": {\n            \"temperature\": \"极冷\",\n    \"表面效果\": {\n              \"凝结\": \"超细液滴的密集覆盖，有机条纹和水晶般清晰的折射。\",\n              \"大气\": \"边缘周围微妙的寒雾和光线扩散，暗示着重量。\"\n            }\n          }\n        },\n    \"dynamic_environment\": {\n          \"foreground_activity\": {\n    \"有机元素\": \"细密的植物毛发和向上伸展的藤蔓。\",\n            \"湿度动态\": \"细密的植物毛发在空中形成的水珠凝结和滴落。\",\n            \"光线动态\": [\n              \"某些藤蔓中微弱的火苗状脉冲，充满温暖。\"\n    \"藤蔓像岩浆脉络的根系一样因边缘照明而发出微光。\"\n            ]\n          },\n          \"background_context\": {\n    \"scenery\": \"模糊的轮廓，展现一片荒芜的地狱森林或深邃的外星植被。\",\n            \"atmospheric_conditions\": \"被雾气和电影般的薄雾遮蔽。\",\n            \"mood_indicators\": \"随着热浪和阴影脉动，暗示着紧张和戏剧性。\"\n          }\n        },\n    \"cinematography_specs\": {\n          \"optical_configuration\": {\n            \"lens\": \"100 mm Macro\",\n    \"aperture\": \"f/8\",\n            \"depth_of_field\": \"浅景深\"\n          },\n          \"focus_map\": {\n    \"sharp_plane\": [\"Fanta Logo\", \"Can Condensation\", \"Closest Vine Textures\"],\n            \"blur_plane\": [\"Background melting into smooth atmospheric bokeh\"]\n          },\n          \"composition_rules\": {\n    \"构图\": \"正面电影式特写，略微向上倾斜角度（英雄式构图）。\",\n            \"布局\": \"罐子下方留有负空间，藤蔓向上伸展。\",\n            \"意图\": \"强调规模和冲击力，同时不压倒主体。\"\n          }\n        },\n    \"lighting_design\": {\n          \"scheme\": \"双色边缘布置\",\n          \"sources\": {\n    \"key_left\": {\n              \"color_temp\": \"冷白光 (~5600 K)\",\n              \"purpose\": \"突出金属高光和水珠效果。\"\n            },\n    \"rim_right\": {\n              \"color_tone\": \"深红橙色\",\n              \"purpose\": \"在藤蔓上创造岩浆纹理的根部发光效果。\"\n            }\n          }\n        }\n      }\n    }",
        "images": [
            "assets/prompts/_____14_1.png",
            "assets/prompts/_____14_2.png",
            "assets/prompts/_____14_3.png",
            "assets/prompts/_____14_4.png"
        ],
        "dominantColors": [
            "red",
            "black",
            "gray"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "Coca-Cola can",
                    "beverage can",
                    "water droplets",
                    "tendrils",
                    "liquid",
                    "metal can"
                ],
                "zh": [
                    "可口可乐罐",
                    "饮料罐",
                    "水滴",
                    "触手",
                    "液体",
                    "金属罐"
                ]
            },
            "scenes": {
                "en": [
                    "abstract",
                    "surreal",
                    "fantasy",
                    "studio shot",
                    "red background",
                    "macro shot"
                ],
                "zh": [
                    "抽象",
                    "超现实",
                    "奇幻",
                    "影棚拍摄",
                    "红色背景",
                    "微距拍摄"
                ]
            },
            "styles": {
                "en": [
                    "3D art",
                    "digital art",
                    "photorealistic",
                    "hyperrealistic",
                    "product photography",
                    "advertising photography",
                    "dynamic composition"
                ],
                "zh": [
                    "3D艺术",
                    "数字艺术",
                    "写实主义",
                    "超写实主义",
                    "产品摄影",
                    "广告摄影",
                    "动态构图"
                ]
            },
            "mood": {
                "en": [
                    "dramatic",
                    "intense",
                    "mysterious",
                    "ominous",
                    "visceral",
                    "powerful",
                    "captivating",
                    "unsettling"
                ],
                "zh": [
                    "戏剧性",
                    "强烈",
                    "神秘",
                    "不祥",
                    "内脏感",
                    "强大",
                    "引人入胜",
                    "令人不安"
                ]
            }
        }
    },
    {
        "id": "prompt-15",
        "title": "天空之城",
        "tags": [
            "3D Art"
        ],
        "description": "# 天空之城\n- Prompt Template\n    # Role Definition\n    You are a **National Spirit Architect (国家精神造景师)**. Your goal is to create a majestic, **fantasy flo...",
        "prompt": "# 天空之城\n- Prompt Template\n    # Role Definition\n    You are a **National Spirit Architect (国家精神造景师)**. Your goal is to create a majestic, **fantasy floating island** that amalgamates the most iconic natural landscapes (famous mountains, rivers, lakes) and architectural landmarks of a specific **Country/Region**.\n    # 角色定义\n    你是一位**国家精神造景师**。你的目标是创造一座雄伟的、**奇幻浮空岛**，将一个特定**国家/地区**最具标志性的自然风光（名山、河流、湖泊）和建筑地标融为一体。\n    # Core Competency\n    **CRITICAL VISUAL STRATEGY (The Harmonious Fusion):**\n    1.  **Abandon Map Logic:** Do NOT follow the real-world map. You are creating an artistic \"Best Of\" composition. Place the snowy mountains behind the tropical lakes; place the capital's palace next to the ancient natural wonders.\n    2.  **Nature-Architecture Symbiosis:** Architecture should not just sit on top; it should be nestled **into** the mountains, perched **on** the cliffs, or surrounded by the winding rivers. The transition between man-made structures and nature must be organic.\n    3.  **The \"Avatar\" Base:** Retain the **tapering, inverted mountain base**. The island looks like a chunk of ancient land lifted by magic, with hanging vines, waterfalls, and rugged rock strata at the bottom.\n    4.  **Flowing Water:** A stylized river or lake system must weave through the composition to connect the disparate elements visually.\n    # 核心能力\n    **关键视觉策略（和谐融合）:**\n    1.  **放弃地图逻辑：** 请不要遵循现实世界地图。你正在创作一个艺术性的\"最佳作品\"组合。将雪山放在热带湖泊后面；将首都的宫殿放在古代自然奇观旁边。\n    2.  **自然-建筑共生：** 建筑不应只是坐落在上面；它应该嵌入山脉中，栖息在悬崖上，或被蜿蜒的河流环绕。人造建筑与自然之间的过渡必须是自然的。\n    3.  **\"化身\"基地：** 保留**锥形倒置的山基**。岛屿看起来像一块被魔法抬起的古老陆地，底部有悬挂的藤蔓、瀑布和崎岖的岩层。\n    4.  **流动的水：** 一个风格化的河流或湖泊系统必须穿过整个组合，以视觉上连接这些分散的元素。\n    # Work Process (Internal \"Chain of Thought\")\n    Based on the provided **{TARGET_COUNTRY}**:\n    1.  **Select Icons:** Identify the top 3-4 visual symbols (e.g., for China: Great Wall, Forbidden City, Yellow Mountains, Yangtze River; for France: Alps, Eiffel Tower, Vineyards, Seine).\n    2.  **Composition Strategy:**\n        * *Back:* High peaks/Mountains (The Backdrop).\n        * *Mid:* Major Architectural Complexes (The Core).\n        * *Front:* Waterways/Lakes and smaller cultural details (The Vibe).\n    3.  **Fusion:** Ensure the Great Wall winds *through* the mountains, or the castle sits *on* the cliff.\n    # 工作流程（内部\"思维链\"）\n    基于提供的 **{TARGET_COUNTRY}**：\n    1.  **选择图标：** 确定前 3-4 个视觉符号（例如，中国的：长城、故宫、黄山、长江；法国的：阿尔卑斯山、埃菲尔铁塔、葡萄园、塞纳河）。\n    2.  **构图策略：**\n    * 背景层：高山/山脉（背景）。\n    * 中景层：主要建筑群（核心）。\n    * 前景层：水道/湖泊和较小的文化细节（氛围）。\n    3.  **融合：** 确保长城蜿蜒穿过山脉，或城堡坐落在悬崖上。\n    # Output Format (The Final Prompt)\n    You will output a single prompt block optimized for **National Landscape Fantasy**:\n    # 输出格式（最终提示）\n    你将输出一个针对**国家风景幻想**优化的单一提示块：\n    - --\n    **Prompt Structure:**\n    - \n        - --\n        **提示结构：**\n    - *[1. The Grand Composition]**\n    A **breathtaking, high-angle fantasy isometric view** of **{TARGET_COUNTRY}** visualized as a **massive, singular floating continent**. The image abandons realistic geography in favor of an **artistic amalgamation** of the country's most famous mountains, rivers, and landmarks blended into one harmonious island.\n    - \n        - *[1. 宏伟构图]**\n        一个**令人惊叹、高角度幻想等距视图**，将**{TARGET_COUNTRY}**呈现为**一个巨大的、单一的漂浮大陆**。图像摒弃了现实地理，取而代之的是将该国最著名的山脉、河流和地标融合成一个和谐岛屿的**艺术混合体**。\n    - *[2. The Natural & Architectural Fusion]**\n    The island is a dense tapestry of **{TARGET_COUNTRY}**'s soul:\n    * **[Zone 1 - The Majestic Backdrop]:** The rear of the island features **{TARGET_COUNTRY}'s most famous mountain ranges and natural peaks** [e.g., snowy peaks, karst mountains, or rolling hills].\n    * **[Zone 2 - The Cultural Core]:** Nestled among the mountains and hills are **iconic historical and modern architectures** of {TARGET_COUNTRY}. [Describe specific landmarks like Palaces, Towers, or Temples] are integrated into the terrain—built into cliffs or sitting in valleys—not just placed flat.\n    * **[Zone 3 - The Water Soul]:** A winding river or serene lake [representative of {TARGET_COUNTRY}'s famous waters] flows through the center, reflecting the architecture. The water cascades off the edge of the floating island into **misty, dreamlike waterfalls**.\n    - \n        - *[2. 自然与建筑融合]**\n        这座岛屿是**{TARGET_COUNTRY}**灵魂的密集织锦：\n        * **[区域 1 - 壮丽背景]**：岛屿的后部呈现**{TARGET_COUNTRY}**最著名的山脉和自然山峰**[例如，雪峰、喀斯特山脉或起伏丘陵]**。\n        * **[区域 2 - 文化核心]**：群山和丘陵之间点缀着**{TARGET_COUNTRY}**标志性的历史与现代建筑**[描述具体地标，如宫殿、塔楼或寺庙]**，它们与地形融为一体——建于悬崖之上或坐落山谷之中，而非简单平铺。\n        * **[区 3 - 水之魂]**：一条蜿蜒的河流或宁静的湖泊[代表{TARGET_COUNTRY}的著名水域]穿过中心，倒映着建筑。水流从浮空岛的边缘倾泻而下，形成**朦胧如梦的水帘**。\n    - *[3. The Floating Base (The Organic Anchor)]**\n    The landmass floats in the sky with a **rugged, inverted-mountain shape**:\n    * **The Underside:** Ancient rock formations, **giant hanging roots**, and dripping water. It creates a silhouette of a mystical flying island. **NO flat concrete slabs.**\n    * **The Atmosphere:** Clouds weave through the mountains and under the island.\n    - \n        - *[3. 浮空基地（有机锚点）]**\n        陆地悬浮在空中，呈**崎岖的倒置山形**：\n        * **底部**：古老的岩石构造、**巨大的悬垂根系**和滴落的水。它勾勒出一个神秘飞岛的形象。**无平坦的水泥板。**\n        * **氛围：** 云雾在山脉间缭绕，穿过岛屿下方。\n    - *[4. The Branding & Atmosphere]**\n    **Epic Fantasy Realism.** The lighting is **magical and dramatic** (e.g., rays of god-light hitting the peaks). **Massive 3D text \"{TARGET_COUNTRY}\"** is integrated into the foreground landscape (e.g., carved into a rock or floating over the water). 8k resolution, highly detailed, octane render, unreal engine 5 style. --no map borders, flat edges, scientific diagram, square box --ar 16:9 --stylize 900 --v 6.0\n    - \n        - *[4. 品牌标识与氛围]**\n        **史诗奇幻写实风格。** 光线**神奇而戏剧化**（例如，神光照射在山峰上）。**巨大的 3D 文字\"{TARGET_COUNTRY}\"** 融入前景景观（例如，雕刻在岩石上或漂浮在水面上）。8k 分辨率，高度细节，Octane 渲染，虚幻引擎 5 风格。 --no 地图边界，平坦边缘，科学图表，方形框 --ar 16:9 --stylize 900 --v 6.0\n    - --\n    # USER INPUT VARIABLE\n    Please generate the prompt for the following target:\n    **{TARGET_COUNTRY} = [请在此处替换为您想要生成的国家或地区名字，如：中国、法国，英国]**\n    # 用户输入变量\n    请为以下目标生成提示：\n    **{TARGET_COUNTRY} = [请在此处替换为您想要生成的国家或地区名字，如：中国、法国，英国]**",
        "images": [
            "assets/prompts/_____15_1.png",
            "assets/prompts/_____15_2.png",
            "assets/prompts/_____15_3.png",
            "assets/prompts/_____15_4.png",
            "assets/prompts/_____15_5.png",
            "assets/prompts/_____15_6.png"
        ],
        "dominantColors": [
            "gray",
            "black"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "floating island",
                    "castle",
                    "landmarks",
                    "river",
                    "waterfall",
                    "cliffs",
                    "clouds",
                    "mountains",
                    "buildings",
                    "trees"
                ],
                "zh": [
                    "浮岛",
                    "城堡",
                    "地标",
                    "河流",
                    "瀑布",
                    "悬崖",
                    "云朵",
                    "山脉",
                    "建筑",
                    "树木"
                ]
            },
            "scenes": {
                "en": [
                    "fantasy landscape",
                    "United Kingdom",
                    "sky",
                    "countryside",
                    "aerial view",
                    "dreamscape",
                    "surreal scene",
                    "mythical place",
                    "nature",
                    "epic view"
                ],
                "zh": [
                    "奇幻风景",
                    "英国",
                    "天空",
                    "乡村",
                    "俯瞰",
                    "梦境",
                    "超现实场景",
                    "神话之地",
                    "自然",
                    "史诗景观"
                ]
            },
            "styles": {
                "en": [
                    "digital art",
                    "photomanipulation",
                    "surrealism",
                    "fantasy art",
                    "landscape art",
                    "concept art",
                    "realistic",
                    "detailed",
                    "panoramic",
                    "high fantasy"
                ],
                "zh": [
                    "数字艺术",
                    "照片处理",
                    "超现实主义",
                    "奇幻艺术",
                    "风景艺术",
                    "概念艺术",
                    "写实",
                    "细致",
                    "全景",
                    "史诗奇幻"
                ]
            },
            "mood": {
                "en": [
                    "majestic",
                    "dreamy",
                    "fantastical",
                    "awe-inspiring",
                    "mysterious",
                    "grand",
                    "ethereal",
                    "serene",
                    "enchanting",
                    "hopeful"
                ],
                "zh": [
                    "雄伟",
                    "梦幻",
                    "奇幻",
                    "令人敬畏",
                    "神秘",
                    "宏伟",
                    "飘渺",
                    "宁静",
                    "迷人",
                    "充满希望"
                ]
            }
        }
    },
    {
        "id": "prompt-16",
        "title": "小说海报",
        "tags": [
            "3D Art"
        ],
        "description": "# 小说海报\n- Prompt Template\n    请为影视剧/小说《需要添加的名称》设计一张高品质的3D海报，需要先检索影视剧/小说信息和著名的片段场景。\n    首先，请利用你的知识库检索这个影视剧/小说的内容，找出一个最具代表性的名场面或核心地点。在画面中央，将这个场景构建为一个精致的轴...",
        "prompt": "# 小说海报\n- Prompt Template\n    请为影视剧/小说《需要添加的名称》设计一张高品质的3D海报，需要先检索影视剧/小说信息和著名的片段场景。\n    首先，请利用你的知识库检索这个影视剧/小说的内容，找出一个最具代表性的名场面或核心地点。在画面中央，将这个场景构建为一个精致的轴侧视角3D微缩模型。风格要采用梦工厂动画那种细腻、柔和的渲染风格。你需要还原当时的建筑细节、人物动态以及环境氛围，无论是暴风雨还是宁静的午后，都要自然地融合在模型的光影里。\n    关于背景，不要使用简单的纯白底。请在模型周围营造一种带有淡淡水墨晕染和流动光雾的虚空环境，色调雅致，让画面看起来有呼吸感和纵深感，衬托出中央模型的珍贵。\n    最后是底部的排版，请生成中文文字。居中写上小说名称，字体要有与原著风格匹配的设计感。在书名下方，自动检索并排版一句原著中关于该场景的经典描写或台词，字体使用优雅的衬线体。整体布局要像一个高级的博物馆藏品铭牌那样精致平衡。",
        "images": [
            "assets/prompts/_____16_1.png"
        ],
        "dominantColors": [
            "gray",
            "black"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "bottle",
                    "ship",
                    "pirate ship",
                    "cork",
                    "water",
                    "waves",
                    "clouds",
                    "sun",
                    "sky",
                    "wooden surface"
                ],
                "zh": [
                    "瓶子",
                    "船",
                    "海盗船",
                    "软木塞",
                    "水",
                    "波浪",
                    "云",
                    "太阳",
                    "天空",
                    "木制表面"
                ]
            },
            "scenes": {
                "en": [
                    "ship in a bottle",
                    "seascape",
                    "miniature world",
                    "ocean",
                    "outdoor",
                    "daytime",
                    "fantasy world"
                ],
                "zh": [
                    "瓶中船",
                    "海景",
                    "微缩世界",
                    "海洋",
                    "户外",
                    "白天",
                    "奇幻世界"
                ]
            },
            "styles": {
                "en": [
                    "miniature art",
                    "diorama",
                    "craft",
                    "whimsical",
                    "fantasy art",
                    "realistic",
                    "conceptual",
                    "detailed"
                ],
                "zh": [
                    "微缩艺术",
                    "立体模型",
                    "手工艺",
                    "奇幻",
                    "奇幻艺术",
                    "写实",
                    "观念",
                    "精致"
                ]
            },
            "mood": {
                "en": [
                    "adventurous",
                    "magical",
                    "dreamy",
                    "mysterious",
                    "whimsical",
                    "peaceful",
                    "captivating",
                    "imaginative"
                ],
                "zh": [
                    "冒险的",
                    "神奇的",
                    "梦幻",
                    "神秘的",
                    "奇幻",
                    "宁静的",
                    "引人入胜",
                    "富有想象力"
                ]
            }
        }
    },
    {
        "id": "prompt-17",
        "title": "微缩提示",
        "tags": [
            "Miniature"
        ],
        "description": "# 微缩提示\n- Prompt Template\n    One prompt to visualize a story's duality through yin-yang design — two opposing aspects of [Subject] occupy interlocking...",
        "prompt": "# 微缩提示\n- Prompt Template\n    One prompt to visualize a story's duality through yin-yang design — two opposing aspects of [Subject] occupy interlocking halves of a circular emblem, viewed from 45° bird's-eye.\n    Same narrative, contrasting realms. Symbolic objects echo across the boundary, hinting at what was lost or gained. Lighting, color, and architecture amplify the tension. Just name the story that deserves its opposing mirror.",
        "images": [
            "assets/prompts/_____17_1.png",
            "assets/prompts/_____17_2.png",
            "assets/prompts/_____17_3.png",
            "assets/prompts/_____17_4.png"
        ],
        "dominantColors": [
            "gray",
            "yellow",
            "brown"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "Totoro",
                    "tree",
                    "house",
                    "umbrella",
                    "bus stop",
                    "acorn",
                    "path",
                    "bench",
                    "grass",
                    "leaves"
                ],
                "zh": [
                    "龙猫",
                    "树",
                    "房子",
                    "伞",
                    "巴士站",
                    "橡子",
                    "小路",
                    "长凳",
                    "草地",
                    "树叶"
                ]
            },
            "scenes": {
                "en": [
                    "forest",
                    "nature",
                    "outdoor",
                    "fantasy world",
                    "miniature world",
                    "countryside",
                    "magical landscape",
                    "Yin and Yang",
                    "dream world",
                    "sky"
                ],
                "zh": [
                    "森林",
                    "自然",
                    "户外",
                    "奇幻世界",
                    "微缩世界",
                    "乡村",
                    "魔法景观",
                    "阴阳",
                    "梦境世界",
                    "天空"
                ]
            },
            "styles": {
                "en": [
                    "3D art",
                    "digital art",
                    "illustration",
                    "cartoon style",
                    "cute",
                    "whimsical",
                    "miniature",
                    "stylized",
                    "fantasy art",
                    "detailed"
                ],
                "zh": [
                    "3D艺术",
                    "数字艺术",
                    "插画",
                    "卡通风格",
                    "可爱",
                    "奇幻",
                    "微缩",
                    "风格化",
                    "奇幻艺术",
                    "细节丰富"
                ]
            },
            "mood": {
                "en": [
                    "peaceful",
                    "dreamy",
                    "calm",
                    "joyful",
                    "whimsical",
                    "magical",
                    "relaxing",
                    "serene",
                    "enchanting",
                    "harmonious"
                ],
                "zh": [
                    "宁静",
                    "梦幻",
                    "平静",
                    "欢快",
                    "奇幻",
                    "神奇",
                    "轻松",
                    "祥和",
                    "迷人",
                    "和谐"
                ]
            }
        }
    },
    {
        "id": "prompt-18",
        "title": "思维拓展",
        "tags": [
            "Creative"
        ],
        "description": "# 思维拓展",
        "prompt": "# 思维拓展",
        "images": [
            "assets/prompts/_____18_1.png",
            "assets/prompts/_____18_2.png",
            "assets/prompts/_____18_3.png",
            "assets/prompts/_____18_4.png",
            "assets/prompts/_____18_5.png",
            "assets/prompts/_____18_6.png"
        ],
        "dominantColors": [
            "gray",
            "yellow",
            "blue"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "girl",
                    "catbus",
                    "Totoro",
                    "umbrella",
                    "tree",
                    "house",
                    "rice paddies",
                    "acorns",
                    "leaves",
                    "soot sprites"
                ],
                "zh": [
                    "女孩",
                    "猫巴士",
                    "龙猫",
                    "雨伞",
                    "树",
                    "房屋",
                    "稻田",
                    "橡子",
                    "树叶",
                    "煤炭精灵"
                ]
            },
            "scenes": {
                "en": [
                    "countryside",
                    "forest",
                    "daytime",
                    "nighttime",
                    "paddy field",
                    "rural setting",
                    "path",
                    "sky",
                    "clouds",
                    "moon"
                ],
                "zh": [
                    "乡村",
                    "森林",
                    "白天",
                    "夜晚",
                    "稻田",
                    "田园风光",
                    "小路",
                    "天空",
                    "云朵",
                    "月亮"
                ]
            },
            "styles": {
                "en": [
                    "anime art",
                    "illustration",
                    "fantasy art",
                    "whimsical",
                    "colorful",
                    "Ghibli style",
                    "cartoon",
                    "narrative art",
                    "day and night",
                    "detailed"
                ],
                "zh": [
                    "动漫艺术",
                    "插画",
                    "奇幻艺术",
                    "异想天开",
                    "多彩",
                    "吉卜力风格",
                    "卡通",
                    "叙事艺术",
                    "日夜交替",
                    "细节丰富"
                ]
            },
            "mood": {
                "en": [
                    "joyful",
                    "dreamy",
                    "peaceful",
                    "magical",
                    "nostalgic",
                    "enchanting",
                    "hopeful",
                    "warm",
                    "childhood",
                    "adventurous"
                ],
                "zh": [
                    "欢快",
                    "梦幻",
                    "宁静",
                    "神奇",
                    "怀旧",
                    "迷人",
                    "充满希望",
                    "温馨",
                    "童真",
                    "冒险"
                ]
            }
        }
    },
    {
        "id": "prompt-19",
        "title": "文章变成卡通信息图",
        "tags": [
            "Illustration"
        ],
        "description": "# 文章变成卡通信息图\n- Prompt Template\n    请根据输入内容提取核心主题与要点，生成一张卡通风格的信息图：\n    - 采用手绘风格，横版（16:9）构图。\n    - 加入少量简洁的卡通元素、图标或名人画像，增强趣味性和视觉记忆。\n    - 如果有敏感人物或者版权内容，画一...",
        "prompt": "# 文章变成卡通信息图\n- Prompt Template\n    请根据输入内容提取核心主题与要点，生成一张卡通风格的信息图：\n    - 采用手绘风格，横版（16:9）构图。\n    - 加入少量简洁的卡通元素、图标或名人画像，增强趣味性和视觉记忆。\n    - 如果有敏感人物或者版权内容，画一个相似替代，但是不要拒绝生成\n    - 所有图像、文字必须使用手绘风格，没有写实风格图画元素\n    - 除非特别要求，否则语言与输入内容语言一致。\n    - 信息精简，突出关键词与核心概念，多留白，易于一眼抓住重点。\n    请根据输入的内容使用 nano banana pro 画图：",
        "images": [
            "assets/prompts/__________19_1.png"
        ],
        "dominantColors": [
            "gray"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "robot",
                    "human",
                    "computer",
                    "lightbulb",
                    "brain",
                    "heart",
                    "book",
                    "wrench",
                    "software bug",
                    "server stack"
                ],
                "zh": [
                    "机器人",
                    "人物",
                    "电脑",
                    "灯泡",
                    "大脑",
                    "心",
                    "书",
                    "扳手",
                    "软件错误",
                    "服务器堆栈"
                ]
            },
            "scenes": {
                "en": [
                    "conceptual diagram",
                    "information visualization",
                    "abstract setting",
                    "research process",
                    "visual explanation"
                ],
                "zh": [
                    "概念图",
                    "信息可视化",
                    "抽象场景",
                    "研究过程",
                    "视觉解释"
                ]
            },
            "styles": {
                "en": [
                    "illustration",
                    "cartoon",
                    "hand-drawn",
                    "infographic",
                    "diagrammatic",
                    "conceptual",
                    "line art",
                    "clean",
                    "explanatory",
                    "technical illustration"
                ],
                "zh": [
                    "插画",
                    "卡通",
                    "手绘",
                    "信息图",
                    "图解式",
                    "概念性",
                    "线条画",
                    "简洁",
                    "说明性",
                    "技术插画"
                ]
            },
            "mood": {
                "en": [
                    "informative",
                    "thought-provoking",
                    "innovative",
                    "futuristic",
                    "analytical",
                    "hopeful",
                    "educational",
                    "conceptual",
                    "curious",
                    "strategic"
                ],
                "zh": [
                    "信息性",
                    "引人深思",
                    "创新",
                    "未来感",
                    "分析性",
                    "充满希望",
                    "教育性",
                    "概念性",
                    "好奇",
                    "战略性"
                ]
            }
        }
    },
    {
        "id": "prompt-20",
        "title": "双重曝光",
        "tags": [
            "Creative"
        ],
        "description": "# 无标题\n- 提示词（需要上传一张照片）\n    A meticulously crafted, vertically composed artistic Christmas portrait.\n    A real person stands bathed in soft, warm holid...",
        "prompt": "# 无标题\n- 提示词（需要上传一张照片）\n    A meticulously crafted, vertically composed artistic Christmas portrait.\n    A real person stands bathed in soft, warm holiday glow, cradling a transparent glass jar close to their face as if holding a gentle star.\n    Inside the jar resides a miniature version of their younger self—the same individual—standing alone within a self-contained, snow-covered microcosm.\n    These two \"selves\" are not mirror images; instead, their gazes intersect, initiating a silent dialogue between reality and distilled identity.\n    The real figure is illuminated by gentle amber Christmas lights, their radiance dissolving softly into the background like a diffused constellation. The glass surface dances with fragmented reflections, splintering the true visage into layered shards that gradually fade along the jar’s curvature—forming a visual bridge between the outer world and the inner realm.\n    Within the jar, snow is sculpted into evocative, lunar-like contours. Beside the tiny figure stands a solitary bottlebrush tree. The miniature self wears intricately detailed festive attire: woven textures, tufted wool fibers, and the plush tactility of winter garments are rendered with astonishing clarity. A serene luminescence glows from deep within the snow, casting an upward light upon the small figure—as if the snow itself still holds the memory of light.\n    Frost patterns crystallize on the jar’s surface—not random snowflakes, but symbolic constellations echoing the twinkling lights behind the figure. Warm-toned fairy lights wrap around the vessel in abstract spirals, transforming it into a quiet cosmic nucleus.\n    The real person’s expression is contemplative, almost cinematic in its depth. Their breath condenses into a delicate mist along the glass rim, adding a fleeting tenderness to the scene.\n    The entire composition evokes layered universes: the external world lush and warm, the internal world refined, suspended, and sacred.\n    For visual cohesion, costumes and props should remain consistent between the inner and outer figures.\n    Rendered in 8K ultra-photorealistic quality, with masterful artistic lighting, sculptural reflections, and poetic textural detail—this image embodies an intimate, symbolic, and quietly supernatural Christmas aesthetic.",
        "images": [
            "assets/prompts/____20_1.png",
            "assets/prompts/____20_2.png",
            "assets/prompts/____20_3.png",
            "assets/prompts/____20_4.png"
        ],
        "dominantColors": [
            "gray"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "hooded figure",
                    "magic ring",
                    "mountains",
                    "river",
                    "forest",
                    "tower",
                    "travelers",
                    "glowing eyes",
                    "cloak",
                    "Eye of Sauron"
                ],
                "zh": [
                    "戴兜帽的人",
                    "魔戒",
                    "山脉",
                    "河流",
                    "森林",
                    "塔楼",
                    "旅行者",
                    "发光的眼睛",
                    "斗篷",
                    "索伦之眼"
                ]
            },
            "scenes": {
                "en": [
                    "fantasy world",
                    "epic journey",
                    "wilderness",
                    "mountain landscape",
                    "riverbank",
                    "misty forest",
                    "twilight",
                    "mystical scene",
                    "Middle-earth",
                    "ominous landscape"
                ],
                "zh": [
                    "奇幻世界",
                    "史诗旅程",
                    "荒野",
                    "山地景观",
                    "河岸",
                    "迷雾森林",
                    "黄昏",
                    "神秘场景",
                    "中土世界",
                    "不祥景观"
                ]
            },
            "styles": {
                "en": [
                    "fantasy art",
                    "digital art",
                    "photo manipulation",
                    "double exposure",
                    "cinematic",
                    "dramatic lighting",
                    "epic art",
                    "dark fantasy",
                    "composite image",
                    "illustrative"
                ],
                "zh": [
                    "奇幻艺术",
                    "数字艺术",
                    "照片处理",
                    "双重曝光",
                    "电影感",
                    "戏剧性光照",
                    "史诗艺术",
                    "黑暗奇幻",
                    "合成图像",
                    "插画风格"
                ]
            },
            "mood": {
                "en": [
                    "epic",
                    "mysterious",
                    "adventurous",
                    "ominous",
                    "determined",
                    "hopeful",
                    "solemn",
                    "powerful",
                    "dark",
                    "magical"
                ],
                "zh": [
                    "史诗般的",
                    "神秘的",
                    "冒险的",
                    "不祥的",
                    "坚定的",
                    "充满希望的",
                    "庄严的",
                    "强大的",
                    "黑暗的",
                    "魔法的"
                ]
            }
        }
    },
    {
        "id": "prompt-21",
        "title": "日历壁纸",
        "tags": [
            "Illustration"
        ],
        "description": "# 日历壁纸\n- 日历壁纸\n    (optional: add your city/language/date at the bottom)\n    ----\n    Please create a cute, stylish calendar illustration in a vertical...",
        "prompt": "# 日历壁纸\n- 日历壁纸\n    (optional: add your city/language/date at the bottom)\n    ----\n    Please create a cute, stylish calendar illustration in a vertical (9:16) layout featuring a fresh, bright, hand-drawn style:\n    Illustration Requirements:\n    - The main character is a young, fashionable female with a cute and lively watercolor or hand-drawn texture, vibrant yet soft colors.\n    - Character features include large eyes, rounded rosy cheeks, and bold, fashionable accessories (e.g., sunglasses, hoop earrings, headscarves, headbands, bows, knit hats, etc.). Clothing should be bright, with dynamic and playful poses. Proportions may be slightly exaggerated (e.g., larger head, slender waist).\n    - Outfit and accessories must reflect seasonal elements, holidays, recommended activities (\"auspicious items\"), or distinctive local characteristics based on the user's location and input. Outfit description: [{Character Outfit Description}]\n    - Character positioned centrally or slightly right-aligned to leave ample whitespace for textual content.\n    - Pure white, minimalist background without additional decorative elements, emphasizing the character and text.\n    Calendar Layout:\n    - Prominent position at the top center: Gregorian date number [{Gregorian Date Number}] (large and eye-catching).\n    - Below the date number, display the English month [{English Month}].\n    - Below the English month, display the year [{Year Number}].\n    - Symmetrical layout left and right of the date: weekday in both local language [{Weekday in Local Language}] and English [{Weekday in English}], along with the lunar date and local holiday [{Lunar or Local Calendar Date}] [{Local Holiday}], ensuring clear, elegant fonts.\n    \"Recommended Activities\" and Inspirational Quote:\n    - Vertically aligned on the left side in bold handwriting: [{Recommended Activities}], using brush calligraphy for Chinese users and complementary handwriting style for other languages, slightly larger and vertically arranged.\n    - To the right of \"Recommended Activities,\" arrange vertically an inspirational and comforting quote [{Inspirational Quote}] in slightly smaller matching handwriting.\n    Localized Elements:\n    - Incorporate distinct local cultural elements or landmarks based on the user's current location or input into the character's outfit, accessories, or details (e.g., city landmarks, climate characteristics, local cultural motifs).\n    General Guidelines:\n    - All elements must be neatly arranged with balanced whitespace.\n    - Ensure text readability without overlapping or obscuring the illustration.\n    - Replace all placeholder content with information dynamically generated based on user input or system-provided user data.",
        "images": [
            "assets/prompts/_____21_1.png",
            "assets/prompts/_____21_2.png",
            "assets/prompts/_____21_3.png",
            "assets/prompts/_____21_4.png"
        ],
        "dominantColors": [
            "white",
            "gray",
            "orange"
        ],
        "aiTags": {
            "objects": {
                "en": [
                    "girl",
                    "beanie",
                    "scarf",
                    "sweater",
                    "pumpkin",
                    "coffee cup",
                    "tote bag",
                    "boots",
                    "gloves",
                    "skirt"
                ],
                "zh": [
                    "女孩",
                    "毛线帽",
                    "围巾",
                    "毛衣",
                    "南瓜",
                    "咖啡杯",
                    "帆布包",
                    "靴子",
                    "手套",
                    "裙子"
                ]
            },
            "scenes": {
                "en": [
                    "autumn",
                    "Thanksgiving",
                    "holiday",
                    "calendar page",
                    "white background"
                ],
                "zh": [
                    "秋天",
                    "感恩节",
                    "节日",
                    "日历页",
                    "白色背景"
                ]
            },
            "styles": {
                "en": [
                    "illustration",
                    "cartoon",
                    "cute",
                    "colorful",
                    "hand-drawn",
                    "character art"
                ],
                "zh": [
                    "插画",
                    "卡通",
                    "可爱",
                    "多彩",
                    "手绘",
                    "人物画"
                ]
            },
            "mood": {
                "en": [
                    "joyful",
                    "peaceful",
                    "warm",
                    "cozy",
                    "festive",
                    "happy",
                    "sweet"
                ],
                "zh": [
                    "欢快",
                    "宁静",
                    "温暖",
                    "舒适",
                    "节日气氛",
                    "快乐",
                    "甜美"
                ]
            }
        }
    },
    {
        "id": "prompt-22",
        "title": "瓶内世界",
        "tags": [
            "Miniature"
        ],
        "description": "# 瓶内世界\n- Prompt\n    A detailed photograph captures a glass bottle containing a miniature scene. Inside is the 'Black Pearl,' a weathered pirate ship w...",
        "prompt": "# 瓶内世界\n- Prompt\n    A detailed photograph captures a glass bottle containing a miniature scene. Inside is the 'Black Pearl,' a weathered pirate ship with torn black sails and Jolly Roger flags, sailing on rough turquoise waves.\n    Above is a sunny sky with white clouds, a bright sun flare, and flying seagulls. The exterior of the glass bottle is covered in water droplets. It rests on a rustic, wet wooden surface with sunlight reflecting off the glass and water. The scene is photorealistic and highly detailed. --ar 3:2",
        "images": [
            "assets/prompts/_____22_1.png"
        ],
        "dominantColors": [
            "gray",
            "brown",
            "orange"
        ],
        "aiTags": {
            "objects": {
                "en": ["glass bottle", "ship", "sea", "boat", "water"],
                "zh": ["玻璃瓶", "船", "海", "小船", "水"]
            },
            "scenes": {
                "en": ["miniature world", "ocean", "fantasy"],
                "zh": ["微缩世界", "海洋", "奇幻"]
            },
            "styles": {
                "en": ["realistic", "miniature", "3D"],
                "zh": ["写实", "微缩", "3D"]
            },
            "mood": {
                "en": ["mysterious", "adventurous", "magical"],
                "zh": ["神秘", "冒险", "奇幻"]
            }
        }
    },
    {
        "id": "prompt-23",
        "title": "穿越",
        "tags": [
            "Creative"
        ],
        "description": "# 穿越\n- Prompt\n    A glowing oval portal stands between {Real_World_Scene} and {Portal_Inner_Scene}.\n    Outside the portal, the real-world environment...",
        "prompt": "# 穿越\n- Prompt\n    A glowing oval portal stands between {Real_World_Scene} and {Portal_Inner_Scene}.\n    Outside the portal, the real-world environment is {Real_World_Scene}, depicted with realistic textures, grounded atmosphere, and gritty or natural tones.\n    Inside the portal lies {Portal_Inner_Scene}, vibrant, imaginative, and contrasting sharply with the real world.\n    {Portal_Inner_Character} is stepping through the portal, turning back with a dynamic glance while holding the viewer’s hand, as if guiding them into the other world.\n    The portal emits mystical blue-purple light, drawn with clean outlines and soft shading consistent with the character’s style.\n    Optional overall visual style: {Art_Style} (defaults to a bold contrast between anime and reality).\n    Camera angle: third-person perspective, clearly showing the viewer’s hand being pulled into the new world.\n    No blur; sharp visual distinction between the two worlds.\n    Aspect ratio: 2:3.\n    ---\n    Real_World_Scene: A winter street in Tokyo, low-saturation neon lights with a faint snowy haze\n    Portal_Inner_Scene:  A futuristic city street glowing with blue holograms, neon refracting through the air\n    Portal_Inner_Character: A cyborg girl with mechanical limbs wearing a semi-armored exosuit",
        "images": [
            "assets/prompts/___23_1.png"
        ],
        "dominantColors": [
            "gray",
            "blue"
        ],
        "aiTags": {
            "objects": {
                "en": ["dinosaur", "city", "people", "street"],
                "zh": ["恐龙", "城市", "人", "街道"]
            },
            "scenes": {
                "en": ["urban", "fantasy", "past and future"],
                "zh": ["城市", "奇幻", "穿越"]
            },
            "styles": {
                "en": ["surreal", "photorealistic", "cinematic"],
                "zh": ["超现实", "写实", "电影感"]
            },
            "mood": {
                "en": ["shocking", "dramatic", "chaotic"],
                "zh": ["震撼", "戏剧性", "混乱"]
            }
        }
    },
    {
        "id": "prompt-24",
        "title": "纸质风",
        "tags": [
            "Illustration"
        ],
        "description": "# 纸质风\n- Prompt Template\n    DRAWING\n    a drawing of [Character], crayon on white paper, in the style of a children's book illustration – simple, cute...",
        "prompt": "# 纸质风\n- Prompt Template\n    DRAWING\n    a drawing of [Character], crayon on white paper, in the style of a children's book illustration – simple, cute, and full-color, with [two glitter accent colors] glitter accents and high detail.\n    Now you turn, share me your prefer character",
        "images": [
            "assets/prompts/____24_1.png",
            "assets/prompts/____24_2.png",
            "assets/prompts/____24_3.png",
            "assets/prompts/____24_4.png"
        ],
        "dominantColors": [
            "gray",
            "red"
        ],
        "aiTags": {
            "objects": {
                "en": ["paper", "layers", "landscape", "mountains"],
                "zh": ["纸", "层叠", "风景", "山"]
            },
            "scenes": {
                "en": ["nature", "abstract landscape"],
                "zh": ["自然", "抽象风景"]
            },
            "styles": {
                "en": ["paper cut", "layered", "minimalist", "craft"],
                "zh": ["剪纸", "层叠", "极简", "手工"]
            },
            "mood": {
                "en": ["calm", "artistic", "soft"],
                "zh": ["平静", "艺术", "柔和"]
            }
        }
    },
    {
        "id": "prompt-25",
        "title": "老照片修复",
        "tags": [
            "Photography"
        ],
        "description": "# 老照片修复\n- Prompt Template\n    Restore and enhance this photograph to professional portrait quality comparable to a Canon EOS R5 capture. Repair all sc...",
        "prompt": "# 老照片修复\n- Prompt Template\n    Restore and enhance this photograph to professional portrait quality comparable to a Canon EOS R5 capture. Repair all scratches, folds, stains, discoloration, and missing details with high-precision reconstruction while preserving the subject's natural Filipino facial features, skin texture, and lighting. Vivid Colourful.",
        "images": [
            "assets/prompts/______25_1.png"
        ],
        "dominantColors": [
            "gray",
            "black"
        ],
        "aiTags": {
            "objects": {
                "en": ["face", "woman", "vintage photo", "scratch"],
                "zh": ["脸", "女性", "老照片", "划痕"]
            },
            "scenes": {
                "en": ["studio", "portrait", "past"],
                "zh": ["工作室", "肖像", "过去"]
            },
            "styles": {
                "en": ["restoration", "vintage", "black and white"],
                "zh": ["修复", "复古", "黑白"]
            },
            "mood": {
                "en": ["nostalgic", "precious", "historical"],
                "zh": ["怀旧", "珍贵", "历史"]
            }
        }
    },
    {
        "id": "prompt-26",
        "title": "雪球肖像",
        "tags": [
            "Creative"
        ],
        "description": "# 无标题\n- 提示词（需要上传一张照片）\n    A meticulously crafted, vertically composed artistic Christmas portrait.\n    A real person stands bathed in soft, warm holid...",
        "prompt": "# 无标题\n- 提示词（需要上传一张照片）\n    A meticulously crafted, vertically composed artistic Christmas portrait.\n    A real person stands bathed in soft, warm holiday glow, cradling a transparent glass jar close to their face as if holding a gentle star.\n    Inside the jar resides a miniature version of their younger self—the same individual—standing alone within a self-contained, snow-covered microcosm.\n    These two \"selves\" are not mirror images; instead, their gazes intersect, initiating a silent dialogue between reality and distilled identity.\n    The real figure is illuminated by gentle amber Christmas lights, their radiance dissolving softly into the background like a diffused constellation. The glass surface dances with fragmented reflections, splintering the true visage into layered shards that gradually fade along the jar’s curvature—forming a visual bridge between the outer world and the inner realm.\n    Within the jar, snow is sculpted into evocative, lunar-like contours. Beside the tiny figure stands a solitary bottlebrush tree. The miniature self wears intricately detailed festive attire: woven textures, tufted wool fibers, and the plush tactility of winter garments are rendered with astonishing clarity. A serene luminescence glows from deep within the snow, casting an upward light upon the small figure—as if the snow itself still holds the memory of light.\n    Frost patterns crystallize on the jar’s surface—not random snowflakes, but symbolic constellations echoing the twinkling lights behind the figure. Warm-toned fairy lights wrap around the vessel in abstract spirals, transforming it into a quiet cosmic nucleus.\n    The real person’s expression is contemplative, almost cinematic in its depth. Their breath condenses into a delicate mist along the glass rim, adding a fleeting tenderness to the scene.\n    The entire composition evokes layered universes: the external world lush and warm, the internal world refined, suspended, and sacred.\n    For visual cohesion, costumes and props should remain consistent between the inner and outer figures.\n    Rendered in 8K ultra-photorealistic quality, with masterful artistic lighting, sculptural reflections, and poetic textural detail—this image embodies an intimate, symbolic, and quietly supernatural Christmas aesthetic.",
        "images": [
            "assets/prompts/snow_globe_portrait_26_1.png"
        ],
        "dominantColors": [
            "black",
            "orange",
            "brown"
        ],
        "aiTags": {
            "objects": {
                "en": ["snow globe", "portrait", "girl", "snow"],
                "zh": ["水晶球", "肖像", "女孩", "雪"]
            },
            "scenes": {
                "en": ["winter", "fantasy", "magical"],
                "zh": ["冬天", "奇幻", "魔法"]
            },
            "styles": {
                "en": ["3D render", "cute", "cartoon"],
                "zh": ["3D渲染", "可爱", "卡通"]
            },
            "mood": {
                "en": ["dreamy", "peaceful", "wintery"],
                "zh": ["梦幻", "宁静", "寒冷"]
            }
        }
    }
];