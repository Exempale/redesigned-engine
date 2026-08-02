// config/email.js
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

console.log('Loading .env from:', path.join(__dirname, '..', '.env'));
console.log('EMAIL_USER from email.js:', process.env.EMAIL_USER);

// Debug: Check if env vars are loaded
console.log('📧 Email config check:');
console.log('  EMAIL_HOST:', process.env.EMAIL_HOST);
console.log('  EMAIL_PORT:', process.env.EMAIL_PORT);
console.log('  EMAIL_USER:', process.env.EMAIL_USER);
console.log('  EMAIL_FROM:', process.env.EMAIL_FROM);
console.log('  VERIFICATION_SECRET:', process.env.VERIFICATION_SECRET ? '✅ Set' : '❌ Missing');

// Use explicit values for mail.ru
const emailConfig = {
    host: process.env.EMAIL_HOST || 'smtp.mail.ru',
    port: 465,  // Force 465, not 587
    secure: true,  // true for 465, false for 587
    auth: {
        user: process.env.EMAIL_USER || 'fortport.noreply@mail.ru',
        pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
        rejectUnauthorized: false, // For self-signed certificates (sometimes needed for mail.ru)
    },
    connectionTimeout: 10000, // 10 seconds
};

console.log('📧 Transporter config:', { host: emailConfig.host, port: emailConfig.port, secure: emailConfig.secure, user: emailConfig.auth.user });

const transporter = nodemailer.createTransport(emailConfig);

// Verification secret
const VERIFICATION_SECRET = process.env.VERIFICATION_SECRET || crypto.randomBytes(32).toString('hex');

// Test the connection on startup (optional)
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email transporter error:', error);
    } else {
        console.log('✅ Email transporter ready');
    }
});

// Generate a verification token
function generateVerificationToken(userId, email) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    const payload = `${userId}:${email}:${expiresAt}`;
    const signature = crypto.createHmac('sha256', VERIFICATION_SECRET)
        .update(payload)
        .digest('hex');
    return Buffer.from(`${payload}:${signature}`).toString('base64url');
}

// Verify and decode a token
function verifyToken(token) {
    try {
        const decoded = Buffer.from(token, 'base64url').toString();
        const parts = decoded.split(':');
        
        if (parts.length !== 4) return null;
        
        const [userId, email, expiresAt, signature] = parts;
        
        const expectedSignature = crypto.createHmac('sha256', VERIFICATION_SECRET)
            .update(`${userId}:${email}:${expiresAt}`)
            .digest('hex');
        
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
            return null;
        }
        
        if (parseInt(expiresAt) < Math.floor(Date.now() / 1000)) {
            return null;
        }
        
        return { userId: parseInt(userId), email };
    } catch (err) {
        return null;
    }
}

// Send verification email
async function sendVerificationEmail(email, username, token, req = null) {
    let baseUrl;
    
    if (req) {
        // Use request headers if available
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
        baseUrl = `${protocol}://${host}`;
    } else {
        // Fallback to environment variable or localhost
        baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    }
    
    const verificationLink = `${baseUrl}/api/verify-email?token=${token}`;
    
    console.log(`🔗 Verification link: ${verificationLink}`);
    
    const mailOptions = {
        from: `"ФортПорт" <${process.env.EMAIL_FROM}>`,
        to: email,
        subject: 'Подтверждение email на ФортПорте',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #15141c;">Добро пожаловать на ФортПорт, ${username}!</h2>
                <p>Для подтверждения email нажмите на кнопку ниже:</p>
                <a href="${verificationLink}" style="display: inline-block; padding: 12px 24px; background: #bef1fc; color: #15141c; text-decoration: none; border-radius: 8px; margin: 20px 0;">Подтвердить email</a>
                <p>Или скопируйте эту ссылку в браузер:</p>
                <p style="word-break: break-all; color: #666;">${verificationLink}</p>
                <p>Ссылка действительна 1 час.</p>
                <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">Если вы не регистрировались на ФортПорте, проигнорируйте это письмо.</p>
            </div>
        `,
        text: `Добро пожаловать на ФортПорт, ${username}!\n\nПодтвердите email, перейдя по ссылке:\n${verificationLink}\n\nСсылка действительна 1 час.\n\nЕсли вы не регистрировались, проигнорируйте это письмо.`,
    };
    
    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent to ${email}, messageId: ${info.messageId}`);
        return true;
    } catch (err) {
        console.error('❌ Email sending error:', err);
        return false;
    }
}

module.exports = { generateVerificationToken, verifyToken, sendVerificationEmail };