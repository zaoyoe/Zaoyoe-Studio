const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Resend } = require('resend');

admin.initializeApp();

// Initialize Resend with API key from environment variable
// Use process.env instead of functions.config() for v7
const resend = new Resend(process.env.RESEND_API_KEY || 're_4tWgh2hj_6qwqn2gwUBKg38JEpmE31WSu');

/**
 * Cloud Function to send password reset emails via Resend
 * This ensures emails arrive in inbox instead of spam
 */
exports.sendPasswordResetEmail = functions.https.onCall(async (data, context) => {
  // For v2 compatibility, data might be wrapped in data.data
  const email = data.email || data.data?.email;

  console.log('Password reset requested for:', email);


  // Validate email
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', '邮箱地址不能为空');
  }

  try {
    // 1. Check if user exists in Firestore
    const usersRef = admin.firestore().collection('users');
    const snapshot = await usersRef.where('email', '==', email).get();

    if (snapshot.empty) {
      console.log('User not found:', email);
      throw new functions.https.HttpsError('not-found', '该邮箱未注册');
    }

    console.log('User found, generating reset link...');

    // 2. Generate Firebase password reset link
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    console.log('Sending email via Resend...');

    // 3. Send beautiful email via Resend
    const { data: emailData, error } = await resend.emails.send({
      from: 'Zaoyoe <noreply@resend.dev>',
      to: email,
      subject: '重置您的 Zaoyoe 密码',
      html: `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>重置密码</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              max-width: 600px;
              margin: 40px auto;
              background: white;
              border-radius: 16px;
              overflow: hidden;
              box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .header {
              background: linear-gradient(135deg, #9b5de5 0%, #f15bb5 100%);
              padding: 40px 30px;
              text-align: center;
            }
            .header h1 {
              margin: 0;
              color: white;
              font-size: 28px;
              font-weight: 700;
            }
            .content {
              padding: 40px 30px;
            }
            .content h2 {
              color: #333;
              font-size: 22px;
              margin: 0 0 20px 0;
            }
            .content p {
              color: #666;
              font-size: 16px;
              line-height: 1.6;
              margin: 0 0 20px 0;
            }
            .button-container {
              text-align: center;
              margin: 35px 0;
            }
            .button {
              display: inline-block;
              padding: 16px 32px;
              background: linear-gradient(135deg, #9b5de5 0%, #f15bb5 100%);
              color: white;
              text-decoration: none;
              border-radius: 12px;
              font-weight: 600;
              font-size: 16px;
              box-shadow: 0 4px 15px rgba(155, 93, 229, 0.4);
              transition: transform 0.2s;
            }
            .button:hover {
              transform: translateY(-2px);
              box-shadow: 0 6px 20px rgba(155, 93, 229, 0.5);
            }
            .link-box {
              background: #f8f9fa;
              padding: 15px;
              border-radius: 8px;
              word-break: break-all;
              font-size: 13px;
              color: #3b82f6;
              margin: 20px 0;
            }
            .footer {
              background: #f8f9fa;
              padding: 30px;
              text-align: center;
              border-top: 1px solid #e5e7eb;
            }
            .footer p {
              color: #9ca3af;
              font-size: 13px;
              margin: 8px 0;
            }
            .warning {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .warning p {
              color: #92400e;
              margin: 0;
              font-size: 14px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 密码重置</h1>
            </div>
            
            <div class="content">
              <h2>您好！</h2>
              <p>我们收到了您重置 <strong>Zaoyoe</strong> 账户密码的请求。</p>
              <p>点击下方按钮即可安全地重置您的密码：</p>
              
              <div class="button-container">
                <a href="${resetLink}" class="button">立即重置密码</a>
              </div>
              
              <p style="color: #9ca3af; font-size: 14px;">或者复制以下链接到浏览器中打开：</p>
              <div class="link-box">${resetLink}</div>
              
              <div class="warning">
                <p><strong>⏰ 重要提示：</strong>此链接将在 <strong>1 小时</strong>后失效，请尽快完成密码重置。</p>
              </div>
              
              <p style="font-size: 14px;">如果您没有请求重置密码，请忽略此邮件。您的密码将保持不变，账户安全不会受到影响。</p>
            </div>
            
            <div class="footer">
              <p><strong>祝好，</strong></p>
              <p><strong>Zaoyoe 团队</strong></p>
              <p style="margin-top: 20px;">此邮件由系统自动发送，请勿回复。</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('Resend error:', error);
      throw new functions.https.HttpsError('internal', '邮件发送失败: ' + error.message);
    }

    console.log('Email sent successfully:', emailData);

    return {
      success: true,
      message: '重置密码邮件已发送到您的邮箱'
    };

  } catch (error) {
    console.error('Error in sendPasswordResetEmail:', error);

    // Re-throw HttpsError as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Wrap other errors
    throw new functions.https.HttpsError('internal', error.message || '未知错误');
  }
});
