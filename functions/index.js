const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const axios = require("axios");
const admin = require("firebase-admin");

const { defineSecret } = require('firebase-functions/params');

// --- SECURITY FIX: RESTRICT CORS ---
// Allow your production app and localhost for testing
const allowedOrigins = [
    'https://fiber-service-query.firebaseapp.com', 
    'https://fiber-service-query.web.app',
    'http://localhost:5000',
    'http://127.0.0.1:5000'
];

const cors = require('cors')({
  origin: function(origin, callback){
    // allow requests with no origin (like mobile apps or curl requests)
    if(!origin) return callback(null, true);
    if(allowedOrigins.indexOf(origin) === -1){
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
});
// -----------------------------------

// 1. Define secrets globally (Correct)
const gmailPassword = defineSecret('GMAIL_PASSWORD');
const recaptchaSecret = defineSecret('RECAPTCHA_SECRET');

admin.initializeApp();

// --- SECURITY FIX: HTML SANITIZATION ---
function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
// ---------------------------------------

exports.createOrderSecure = onRequest(
    // 2. Allow access to secrets here
    { secrets: [gmailPassword, recaptchaSecret] }, 
    (req, res) => {
        cors(req, res, async () => {
            try {
                // --- MOVED INSIDE: Secrets are only available here ---
                const secretKey = recaptchaSecret.value(); 
                const emailPass = gmailPassword.value();

                if (req.method !== 'POST') {
                    res.status(405).send('Method Not Allowed');
                    return;
                }

                // ... Parsing Logic ...
                let data = req.body;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { /* handle error */ }
                }
                if (data && data.data) data = data.data;

                logger.info("Parsed Order Data:", data); 

                // Validate Input
                if (!data.captchaToken || !data.orderDetails) {
                    res.status(400).json({ success: false, error: "Missing Data" });
                    return;
                }

                // --- USE SECRET HERE ---
                const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${data.captchaToken}`;
                const captchaResponse = await axios.post(verifyUrl);
                
                if (!captchaResponse.data.success) {
                    logger.error("Captcha failed:", captchaResponse.data);
                    res.status(403).json({ success: false, error: "Captcha verification failed." });
                    return;
                }

                // Save to Firestore
                const writeResult = await admin.firestore()
                    .collection('artifacts')
                    .doc('nptel-map-portal')
                    .collection('public')
                    .doc('data')
                    .collection('orders')
                    .add({
                        ...data.orderDetails,
                        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
                        status: 'pending',
                        source: 'secure_function'
                    });

                // --- USE SECRET HERE ---
                try {
                    const transporter = nodemailer.createTransport({
                        service: "gmail",
                        auth: {
                            user: "jmiller@nptel.com", 
                            pass: emailPass // Accessed from inside the function
                        }
                    });
                    
                    // --- SECURITY FIX: Sanitize Inputs ---
                    const safeName = escapeHtml(data.orderDetails.name);
                    const safePhone = escapeHtml(data.orderDetails.phone);
                    const safeEmail = escapeHtml(data.orderDetails.email);
                    const safeAddress = escapeHtml(data.orderDetails.address);
                    const safePlan = escapeHtml(data.orderDetails.planDetails || data.orderDetails.plan);
                    // -------------------------------------

                    await transporter.sendMail({
                        from: '"Fiber Bot" <jmiller@nptel.com>',
                        to: "jmiller@nptel.com, ppenrose@nptel.com, dneff@nptel.com, sbechler@nptel.com",
                        subject: `New Fiber Order: ${safeName}`, // Safe
                        html: `
                            <h2>New Secure Order Received</h2>
                            <p><strong>Name:</strong> ${safeName}</p>
                            <p><strong>Phone:</strong> ${safePhone}</p>
                            <p><strong>Email:</strong> ${safeEmail}</p>
                            <p><strong>Address:</strong> ${safeAddress}</p>
                            <p><strong>Plan:</strong> ${safePlan}</p>
                            <hr>
                            <p><em>Verified via ReCAPTCHA</em></p>
                        `
                    });
                } catch (emailErr) {
                    logger.error("Email failed but order saved:", emailErr);
                }

                res.status(200).json({ success: true, orderId: writeResult.id });

            } catch (error) {
                logger.error("Global function error:", error);
                res.status(500).json({ success: false, error: error.message });
            }
        });
});