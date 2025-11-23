document.addEventListener('DOMContentLoaded', () => {
    // Tab Switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            // Add active class to clicked
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });

    // --- Copywriting Generator ---
    const generateBtn = document.getElementById('generateBtn');
    const copyBtn = document.getElementById('copyBtn');
    const copyOutput = document.getElementById('copyOutput');

    const templates = {
        moving: "【搬家急出】{name}，{condition}。因为工作调动要搬家了，东西太多带不走，忍痛割爱。功能完好，没有任何暗病。价格{price}元，爽快的来，手慢无！",
        gift: "【年会奖品】{name}，{condition}。公司年会中的奖品，自己用不上，低价转让给有缘人。绝对正品，支持验货。价格{price}元，诚心要的私聊。",
        impulse: "【回血出】{name}，{condition}。之前冲动消费买的，买回来没用过几次，一直吃灰。现在缺钱回血，{price}元出。成色如图，所见即所得。",
        upgrade: "【换新闲置】{name}，{condition}。因为换了新款，旧的这个就闲置了。一直很爱惜，贴膜带套使用的。{price}元带走，希望能给它找个好主人。"
    };

    generateBtn.addEventListener('click', () => {
        const name = document.getElementById('productName').value || '宝贝';
        const condition = document.getElementById('condition').value;
        const reason = document.getElementById('reason').value;
        const price = document.getElementById('price').value || '面议';

        let text = templates[reason];
        text = text.replace('{name}', name)
            .replace('{condition}', condition)
            .replace('{price}', price);

        copyOutput.value = text;
    });

    copyBtn.addEventListener('click', () => {
        copyOutput.select();
        document.execCommand('copy');
        const originalText = copyBtn.textContent;
        copyBtn.textContent = "已复制！";
        setTimeout(() => copyBtn.textContent = originalText, 2000);
    });

    // --- Image Watermarker ---
    const imageUpload = document.getElementById('imageUpload');
    const watermarkControls = document.getElementById('watermarkControls');
    const canvas = document.getElementById('imageCanvas');
    const ctx = canvas.getContext('2d');
    const downloadBtn = document.getElementById('downloadBtn');

    const watermarkText = document.getElementById('watermarkText');
    const watermarkColor = document.getElementById('watermarkColor');
    const watermarkSize = document.getElementById('watermarkSize');

    let uploadedImage = null;

    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                uploadedImage = new Image();
                uploadedImage.onload = () => {
                    watermarkControls.style.display = 'block';
                    drawWatermark();
                };
                uploadedImage.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    function drawWatermark() {
        if (!uploadedImage) return;

        // Set canvas size to match image (scaled down for display if needed, but keeping aspect ratio)
        // For high quality output, we should use original image dimensions
        canvas.width = uploadedImage.width;
        canvas.height = uploadedImage.height;

        // Draw original image
        ctx.drawImage(uploadedImage, 0, 0);

        // Configure text style
        const fontSize = (watermarkSize.value / 100) * (canvas.width / 10); // Responsive font size
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = watermarkColor.value;
        ctx.globalAlpha = 0.7; // Semi-transparent
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw text in the center (can be improved to be draggable)
        ctx.fillText(watermarkText.value, canvas.width / 2, canvas.height / 2);

        // Reset alpha
        ctx.globalAlpha = 1.0;
    }

    // Add listeners for live updates
    [watermarkText, watermarkColor, watermarkSize].forEach(el => {
        el.addEventListener('input', drawWatermark);
    });

    downloadBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'watermarked-image.png';
        link.href = canvas.toDataURL();
        link.click();
    });
});
