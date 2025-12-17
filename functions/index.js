const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const axios = require("axios");
const admin = require("firebase-admin");

const { defineSecret } = require('firebase-functions/params');

// --- SECURITY FIX: RESTRICT CORS ---
const allowedOrigins = [
    'https://fiber-service-query.firebaseapp.com', 
    'https://fiber-service-query.web.app',
    'http://localhost:5000',
    'http://127.0.0.1:5000'
];

const cors = require('cors')({
  origin: function(origin, callback){
    if(!origin) return callback(null, true);
    if(allowedOrigins.indexOf(origin) === -1){
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  }
});
// -----------------------------------

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
    { secrets: [gmailPassword, recaptchaSecret] }, 
    (req, res) => {
        cors(req, res, async () => {
            try {
                const secretKey = recaptchaSecret.value(); 
                const emailPass = gmailPassword.value();

                if (req.method !== 'POST') {
                    res.status(405).send('Method Not Allowed');
                    return;
                }

                let data = req.body;
                if (typeof data === 'string') {
                    try { data = JSON.parse(data); } catch (e) { /* handle error */ }
                }
                if (data && data.data) data = data.data;

                logger.info("Parsed Order Data:", data); 

                if (!data.captchaToken || !data.orderDetails) {
                    res.status(400).json({ success: false, error: "Missing Data" });
                    return;
                }

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

                try {
                    const transporter = nodemailer.createTransport({
                        service: "gmail",
                        auth: {
                            user: "jmiller@nptel.com", 
                            pass: emailPass 
                        }
                    });
                    
                    // --- SECURITY FIX: Sanitize Inputs ---
                    const safeName = escapeHtml(data.orderDetails.name);
                    const safePhone = escapeHtml(data.orderDetails.phone);
                    const safeEmail = escapeHtml(data.orderDetails.email);
                    const safeAddress = escapeHtml(data.orderDetails.address);
                    const safePlan = escapeHtml(data.orderDetails.planDetails || data.orderDetails.plan);
                    
                    // NEW: Sanitize Addons & Requests
                    const rawAddOns = data.orderDetails.addOns || [];
                    const safeAddOns = Array.isArray(rawAddOns) 
                        ? rawAddOns.map(escapeHtml).join('<br>&bull; ') 
                        : "None";
                    
                    const safeSpecialRequests = escapeHtml(data.orderDetails.specialRequests || "None");
                    // -------------------------------------

                    await transporter.sendMail({
                        from: '"Fiber Bot" <jmiller@nptel.com>',
                        to: "jmiller@nptel.com, ppenrose@nptel.com, dneff@nptel.com, sbechler@nptel.com",
                        subject: `New Fiber Order: ${safeName}`, 
                        html: `
                            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd;">
                                <h2 style="color: #1e3c72;">New Secure Order Received</h2>
                                <p><strong>Name:</strong> ${safeName}</p>
                                <p><strong>Phone:</strong> ${safePhone}</p>
                                <p><strong>Email:</strong> ${safeEmail}</p>
                                <p><strong>Address:</strong> ${safeAddress}</p>
                                <div style="background: #f0f7ff; padding: 15px; border-radius: 5px; margin: 15px 0;">
                                    <h3 style="margin-top:0;">Selected Plan</h3>
                                    <p style="font-size: 1.1em; font-weight: bold;">${safePlan}</p>
                                </div>
                                
                                <div style="background: #fff; border: 1px solid #eee; padding: 15px; border-radius: 5px;">
                                    <h3 style="margin-top:0;">Add-ons</h3>
                                    ${safeAddOns !== "None" ? '<p>&bull; ' + safeAddOns + '</p>' : '<p>None selected</p>'}
                                </div>

                                <div style="background: #fff; border: 1px solid #eee; padding: 15px; border-radius: 5px; margin-top: 15px;">
                                    <h3 style="margin-top:0;">Special Requests / Notes</h3>
                                    <p>${safeSpecialRequests}</p>
                                </div>
                                <hr>
                                <p><em>Verified via ReCAPTCHA</em></p>
                            </div>
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