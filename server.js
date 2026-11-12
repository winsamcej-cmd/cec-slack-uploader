const express = require('express');
const multer = require('multer');
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;

app.use(express.static('public'));

// 1. Fetch channels the bot has access to
app.get('/api/channels', async (req, res) => {
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

// 2. Receive optimized image & upload to Slack via 3-step flow
app.post('/api/upload', upload.single('photo'), async (req, res) => {
  try {
    const { channelId, senderName, caption } = req.body;
    const file = req.file;

    if (!file || !channelId) {
      return res.status(400).json({ error: 'Missing image or channel' });
    }

    // Step A: Request an external upload URL from Slack
    const urlRes = await fetch('https://slack.com/api/files.getUploadURLExternal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        filename: file.originalname || 'photo.jpg',
        length: file.size.toString(),
      }),
    });
    const urlData = await urlRes.json();
    if (!urlData.ok) throw new Error(urlData.error);

    // Step B: Upload the raw compressed bytes to Slack's upload URL
    const uploadRes = await fetch(urlData.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': file.mimetype },
      body: file.buffer,
    });
    if (!uploadRes.ok) throw new Error('Failed to transfer file bytes');

    // Step C: Finalize upload & post to channel with sender's name
    const formattedMessage = `*Sent by ${senderName || 'Anonymous'}*${caption ? `: ${caption}` : ''}`;

    const completeRes = await fetch('https://slack.com/api/files.completeUploadExternal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: [{ id: urlData.file_id, title: file.originalname || 'Photo' }],
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`App running on http://localhost:${PORT}`));