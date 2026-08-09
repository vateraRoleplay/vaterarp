/**
 * server-webhook-example.js
 *
 * Contoh backend sederhana untuk:
 *  1) Membuat transaksi pembayaran (dipanggil dari tombol "Bayar Otomatis" di index.html)
 *  2) Menerima WEBHOOK notifikasi status pembayaran dari Midtrans
 *
 * PENTING: index.html adalah file statis (HTML/JS di browser saja).
 * Webhook adalah panggilan SERVER-KE-SERVER dari Midtrans ke server KAMU —
 * jadi ini WAJIB dijalankan di backend terpisah (VPS, Railway, Render, dll),
 * bukan di dalam file HTML. Setelah jalan, isi "Backend URL" di Panel Admin
 * situs dengan alamat server ini (contoh: https://api-vaterastore.com).
 *
 * Install:
 *   npm init -y
 *   npm install express midtrans-client cors dotenv
 *
 * Buat file .env di folder yang sama:
 *   MIDTRANS_SERVER_KEY=Mid-server-xxxxxxxxxxxxxxxx
 *   MIDTRANS_CLIENT_KEY=Mid-client-xxxxxxxxxxxxxxxx
 *   MIDTRANS_PRODUCTION=false
 *   PORT=3000
 *   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxxxx/xxxxxxx
 *
 * CATATAN soal Discord: webhook Discord HANYA bisa dipakai untuk MENGIRIM pesan
 * ke channel Discord, bukan untuk menerima notifikasi pembayaran dari Midtrans
 * (format datanya beda, Discord akan menolaknya). Jadi alurnya:
 *   Midtrans --webhook--> backend ini --> backend ini kirim pesan ke Discord Webhook
 * Bukan: Midtrans --webhook--> langsung ke Discord.
 *
 * Jalankan:
 *   node server-webhook-example.js
 *
 * Lalu daftarkan URL webhook di Dashboard Midtrans:
 *   Settings > Configuration > Payment Notification URL
 *   isi dengan: https://domain-server-kamu.com/webhook
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');

const app = express();
app.use(cors());
app.use(express.json());

// ==== KONFIGURASI ====
// Server Key JANGAN pernah ditaruh di frontend/index.html — hanya di sini (.env server).
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;
const IS_PRODUCTION = process.env.MIDTRANS_PRODUCTION === 'true';

const snap = new midtransClient.Snap({
  isProduction: IS_PRODUCTION,
  serverKey: MIDTRANS_SERVER_KEY,
  clientKey: MIDTRANS_CLIENT_KEY
});

// Simpan status order sementara di memory.
// Untuk produksi, ganti dengan database asli (MySQL/MongoDB/PostgreSQL/dll).
const orders = {};

function parseHarga(hargaText) {
  // Ubah teks harga seperti "Rp50rb" menjadi angka 50000
  const angka = parseInt(String(hargaText).replace(/[^0-9]/g, ''), 10) || 0;
  return angka * 1000;
}

// ---- TAMBAHAN: kirim notifikasi ke Discord lewat Discord Webhook ----
// Bikin URL webhook-nya di Discord: Server Settings > Integrations > Webhooks > New Webhook > Copy URL
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendDiscordNotif(order, orderId) {
  if (!DISCORD_WEBHOOK_URL) return; // kalau belum di-set, lewati saja
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '✅ Pembayaran Masuk — Vatera Store',
          color: 0xf2b93a,
          fields: [
            { name: 'Order ID', value: orderId, inline: false },
            { name: 'Item', value: order.itemName, inline: true },
            { name: 'Player ID', value: String(order.playerId), inline: true },
            { name: 'Total', value: `Rp${order.grossAmount.toLocaleString('id-ID')}`, inline: true }
          ],
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (err) {
    console.error('Gagal kirim notifikasi Discord:', err.message);
  }
}

// ---- 1) Endpoint dipanggil dari website saat user klik "Bayar Otomatis" ----
app.post('/create-transaction', async (req, res) => {
  try {
    const { itemId, itemName, harga, playerId } = req.body;
    if (!itemId || !itemName || !harga || !playerId) {
      return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    const orderId = `VATERA-${itemId}-${Date.now()}`;
    const grossAmount = parseHarga(harga);

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: grossAmount
      },
      item_details: [{
        id: String(itemId),
        price: grossAmount,
        quantity: 1,
        name: itemName
      }],
      customer_details: {
        first_name: `Player-${playerId}`
      }
    };

    const transaction = await snap.createTransaction(parameter);

    orders[orderId] = {
      itemId, itemName, playerId, grossAmount,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    res.json({ token: transaction.token, orderId });
  } catch (err) {
    console.error('Gagal membuat transaksi:', err.message);
    res.status(500).json({ error: 'Gagal membuat transaksi' });
  }
});

// ---- 2) WEBHOOK: dipanggil otomatis oleh Midtrans setiap status pembayaran berubah ----
app.post('/webhook', async (req, res) => {
  try {
    const notification = await snap.transaction.notification(req.body);

    const orderId = notification.order_id;
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    const order = orders[orderId];
    if (!order) {
      console.warn('Webhook diterima untuk order yang tidak dikenal:', orderId);
      return res.status(200).send('OK'); // tetap balas 200 supaya Midtrans tidak retry terus
    }

    if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
      if (fraudStatus === 'accept' || !fraudStatus) {
        order.status = 'paid';
        console.log(`✅ LUNAS: ${orderId} — "${order.itemName}" untuk player ${order.playerId}`);

        sendDiscordNotif(order, orderId); // kirim notif ke admin di Discord

        // TODO: proses item ke game secara otomatis, contoh:
        // - panggil RCON / API server SAMP kamu untuk kasih item ke playerId
        // - simpan status "paid" ke database asli
      }
    } else if (transactionStatus === 'pending') {
      order.status = 'pending';
    } else if (['deny', 'cancel', 'expire', 'failure'].includes(transactionStatus)) {
      order.status = 'failed';
      console.log(`❌ Gagal/batal: ${orderId}`);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Gagal memproses webhook:', err.message);
    res.status(500).send('Error');
  }
});

// ---- 3) (Opsional) cek status order dari frontend, misal buat polling ----
app.get('/order-status/:orderId', (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) return res.status(404).json({ error: 'Order tidak ditemukan' });
  res.json(order);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook server jalan di port ${PORT}`));
