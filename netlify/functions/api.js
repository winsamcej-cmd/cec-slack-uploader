const express = require('express');
const multer = require('multer');
const serverless = require('serverless-http');

const app = express();
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

router.get('/channels', async (req, res) => {
  try {
    const response = await fetch(
      'https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=1000',
      { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } }
    );
    const data = await response.json();
    if (!data.ok) return res.status(400).json({ error: data.error });

    const channels = data.channels
      .filter((c) => c.is_member)
      .map((c) => ({ id: c.id, name: c.name }));

    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load channels' });
  }
});

router.post('/upload', upload.array('photos', 10), async (req, res) => {
  try {
    const { channelId, senderName, caption } = req.body;
    const files = req.files;

    if (!files || !files.length || !channelId) {
      return res.status(400).json({ error: 'Missing images or channel' });
    }

    // Upload all files to Slack simultaneously (prevents Netlify 10s timeout)
    const uploadedFiles = await Promise.all(
      files.map(async (file, i) => {
        const filename = file.originalname || `photo_${i + 1}.jpg`;

        const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${SLACK_TOKEN}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            filename,
            length: file.size.toString(),
          }),
        });
        const urlData = await urlRes.json();
        if (!urlData.ok) throw new Error(urlData.error);

        const uploadRes = await fetch(urlData.upload_url, {
          method: 'POST',
          headers: { 'Content-Type': file.mimetype },
          body: file.buffer,
        });
        if (!uploadRes.ok) throw new Error(`Failed to transfer ${filename}`);

        return { id: urlData.file_id, title: filename };
      })
    );

    const formattedMessage = `*Sent by ${senderName || 'Anonymous'}*${caption ? `: ${caption}` : ''}`;

    const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: uploadedFiles,
        channel_id: channelId,
        initial_comment: formattedMessage,
      }),
    });
    const completeData = await completeRes.json();
    if (!completeData.ok) throw new Error(completeData.error);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/', router);
module.exports.handler = serverless(app);
