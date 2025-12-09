const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const axios = require("axios");
const admin = require("firebase-admin");
const cors = require('cors')({ origin: true });

admin.initializeApp();

// --- CONFIGURATION ---
const TRANSPORTER_CONFIG = {
    service: "gmail",
    auth: {
        user: "jmiller@nptel.com", 
        pass: "exsg mytr benl cxjn" 
    }
};

const RECAPTCHA_SECRET = "6Lduo28rAAAAAGk4CNmP9YfxIH9M3JATWcpxFvwi"; 

exports.createOrderSecure = onRequest((req, res) => {
    // 1. Handle CORS
    cors(req, res, async () => {
        try {
            // Check method
            if (req.method !== 'POST') {
                res.status(405).send('Method Not Allowed');
                return;
            }

            // --- DEBUG LOGGING START ---
            logger.info("Headers:", req.headers);
            logger.info("Raw Body Type:", typeof req.body);
            logger.info("Raw Body Content:", req.body);
            // --- DEBUG LOGGING END ---

            // 2. Robust Data Parsing
            let data = req.body;
            
            // Handle different content types if necessary
            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    logger.error("Failed to parse body string", e);
                    res.status(400).json({ success: false, error: "Invalid JSON body string" });
                    return;
                }
            }
            
            // Check if data is wrapped in a 'data' property (common with some fetch configs or axios)
            // or if it was sent as raw JSON.
            if (data && data.data) {
                 logger.info("Unwrapping 'data' property");
                 data = data.data;
            }


            logger.info("Parsed Order Data:", data); 

            // 3. Validate Input
            if (!data.captchaToken) {
                logger.error("Missing captcha token. Data received:", data);
                res.status(400).json({ success: false, error: "Missing Captcha Token" });
                return;
            }

            if (!data.orderDetails) {
                 logger.error("Missing order details. Data received:", data);
                 res.status(400).json({ success: false, error: "Missing Order Details" });
                 return;
            }

            // 4. Verify ReCAPTCHA
            const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${RECAPTCHA_SECRET}&response=${data.captchaToken}`;
            const captchaResponse = await axios.post(verifyUrl);
            
            if (!captchaResponse.data.success) {
                logger.error("Captcha failed:", captchaResponse.data);
                res.status(403).json({ success: false, error: "Captcha verification failed." });
                return;
            }

            // 5. Save to Firestore
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

            // 6. Send Email
            try {
                const transporter = nodemailer.createTransport(TRANSPORTER_CONFIG);
                await transporter.sendMail({
                    from: '"Fiber Bot" <jmiller@nptel.com>',
                    to: "jmiller@nptel.com",
                    subject: `New Fiber Order: ${data.orderDetails.name}`,
                    html: `
                        <h2>New Secure Order Received</h2>
                        <p><strong>Name:</strong> ${data.orderDetails.name}</p>
                        <p><strong>Phone:</strong> ${data.orderDetails.phone}</p>
                        <p><strong>Email:</strong> ${data.orderDetails.email}</p>
                        <p><strong>Address:</strong> ${data.orderDetails.address}</p>
                        <p><strong>Plan:</strong> ${data.orderDetails.planDetails || data.orderDetails.plan}</p>
                        <hr>
                        <p><em>Verified via ReCAPTCHA</em></p>
                    `
                });
            } catch (emailErr) {
                logger.error("Email failed but order saved:", emailErr);
            }

            // 7. Success Response
            res.status(200).json({ success: true, orderId: writeResult.id });

        } catch (error) {
            logger.error("Global function error:", error);
            res.status(500).json({ success: false, error: error.message });
        }
    });
});