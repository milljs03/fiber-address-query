const { onCall } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const axios = require("axios");
const admin = require("firebase-admin");

admin.initializeApp();

// Configure your email sender
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: "your-email@nptel.com", // REPLACE THIS
        pass: "your-google-app-password" // REPLACE THIS (Not your login password!)
    }
});

// SECRET KEY from Google Recaptcha Admin Console (Server side key)
const RECAPTCHA_SECRET = "YOUR_SECRET_KEY_FROM_GOOGLE_ADMIN"; 

exports.createOrderSecure = onCall(async (request) => {
    const data = request.data;
    
    // 1. Verify ReCAPTCHA Token
    if (!data.captchaToken) {
        throw new Error("Missing Captcha Token");
    }

    const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET}&response=${data.captchaToken}`;
    
    try {
        const captchaResponse = await axios.post(verifyUrl);
        if (!captchaResponse.data.success) {
            throw new Error("Captcha Verification Failed. Are you a robot?");
        }
    } catch (error) {
        logger.error("Captcha Error", error);
        throw new Error("Failed to verify captcha.");
    }

    // 2. If Captcha is good, save to Firestore
    // We do this server-side so we can remove 'create' permission from the public in the future if we want!
    const writeResult = await admin.firestore()
        .collection('artifacts')
        .doc('nptel-map-portal') // Your App ID
        .collection('public')
        .doc('data')
        .collection('orders')
        .add({
            ...data.orderDetails,
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'pending',
            source: 'secure_function'
        });

    // 3. Send Email Notification
    const mailOptions = {
        from: '"Fiber Bot" <your-email@nptel.com>',
        to: "jmiller@nptel.com",
        subject: `New Fiber Order: ${data.orderDetails.name}`,
        html: `
            <h2>New Secure Order Received</h2>
            <p><strong>Name:</strong> ${data.orderDetails.name}</p>
            <p><strong>Phone:</strong> ${data.orderDetails.phone}</p>
            <p><strong>Email:</strong> ${data.orderDetails.email}</p>
            <p><strong>Address:</strong> ${data.orderDetails.address}</p>
            <p><strong>Plan:</strong> ${data.orderDetails.plan}</p>
            <hr>
            <p><em>Verified via ReCAPTCHA</em></p>
        `
    };

    await transporter.sendMail(mailOptions);

    return { success: true, orderId: writeResult.id };
});