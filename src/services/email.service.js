import nodemailer from "nodemailer";

function required(name) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error("EMAIL_NOT_CONFIGURED");
    return value;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>\"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
}

function getTransport() {
    const tlsServername = String(process.env.SMTP_TLS_SERVERNAME || "").trim();
    return nodemailer.createTransport({
        host: required("SMTP_HOST"),
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
        auth: { user: required("SMTP_USER"), pass: required("SMTP_PASSWORD") },
        ...(tlsServername ? { tls: { servername: tlsServername, rejectUnauthorized: true } } : {}),
    });
}

export async function sendTwoFactorCode({ to, code }) {
    const from = required("EMAIL_FROM");
    const fromName = String(process.env.EMAIL_FROM_NAME || "Enmae Paie").trim() || "Enmae Paie";
    const safeCode = escapeHtml(code);
    const safeFromName = escapeHtml(fromName);
    try {
        return await getTransport().sendMail({
            from: { name: fromName, address: from },
            to,
            subject: "Votre code de vérification Paie Software",
            text: `Paie Software\n\nVotre code de vérification est : ${code}\n\nCe code expire dans 10 minutes. Si vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.`,
            html: `<!doctype html>
<html lang="fr">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code de vérification</title>
</head>
<body style="margin:0;background:#f4f7fb;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Votre code de vérification Paie Software expire dans 10 minutes.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:36px 16px;">
        <tr><td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e6ebf2;border-radius:16px;overflow:hidden;">
                <tr><td style="background:#18264a;padding:26px 36px;">
                    <div style="font-size:13px;line-height:20px;letter-spacing:1.8px;text-transform:uppercase;color:#aebfff;font-weight:bold;">${safeFromName}</div>
                    <div style="font-size:26px;line-height:34px;color:#ffffff;font-weight:bold;margin-top:5px;">Vérification de connexion</div>
                </td></tr>
                <tr><td style="padding:38px 36px 30px;">
                    <p style="font-size:16px;line-height:26px;margin:0 0 10px;">Bonjour,</p>
                    <p style="font-size:16px;line-height:26px;color:#526078;margin:0 0 28px;">Une tentative de connexion à votre espace Paie Software nécessite une vérification supplémentaire.</p>
                    <div style="background:#f1f5ff;border:1px solid #d9e2ff;border-radius:12px;padding:22px;text-align:center;">
                        <div style="font-size:12px;line-height:18px;letter-spacing:1.5px;text-transform:uppercase;color:#5870c8;font-weight:bold;">Votre code</div>
                        <div style="font-size:36px;line-height:46px;letter-spacing:8px;color:#18264a;font-weight:bold;margin:7px 0 2px 8px;">${safeCode}</div>
                        <div style="font-size:13px;line-height:20px;color:#6d7890;">Valable pendant 10 minutes</div>
                    </div>
                    <p style="font-size:14px;line-height:22px;color:#526078;margin:28px 0 0;">Saisissez ce code dans la page de vérification pour terminer votre connexion.</p>
                </td></tr>
                <tr><td style="padding:0 36px;"><div style="height:1px;background:#edf0f5;"></div></td></tr>
                <tr><td style="padding:24px 36px 30px;">
                    <p style="font-size:13px;line-height:21px;color:#7b879b;margin:0;">Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail. Ne partagez jamais ce code avec quelqu’un d’autre.</p>
                </td></tr>
            </table>
            <p style="font-size:12px;line-height:18px;color:#8b96a8;margin:18px 0 0;">E-mail automatique de ${safeFromName}. Merci de ne pas répondre.</p>
        </td></tr>
    </table>
</body>
</html>`,
        });
    } catch (error) {
        if (error?.code === "ERR_TLS_CERT_ALTNAME_INVALID") {
            const tlsError = new Error("SMTP_CERTIFICATE_HOSTNAME_MISMATCH");
            tlsError.cause = error;
            throw tlsError;
        }
        throw error;
    }
}
