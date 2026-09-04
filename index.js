const express = require('express');
require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');

// 1. Initialize Firebase Admin SDK (Modern Modular API)
const serviceAccount = require('./firebase-key.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();
const app = express();

// Set up your INRDeals API credentials
// In a production environment, keep the token secret using environment variables!
const INRDEALS_API_TOKEN = process.env.INRDEALS_API_TOKEN;

// 2. The Sync Endpoint
// This is the URL path (/sync) that cron-job.org will ping every 4 hours.
app.get('/sync', async (req, res) => {
    try {
        console.log("Starting INRDeals transaction sync...");

        // Fetch recent transactions from INRDeals with a browser disguise
        const response = await axios.get('https://inrdeals.com/api/v1/transactions', {
            params: {
                token: INRDEALS_API_TOKEN
            },
            headers: {
                // This tells Cloudflare we are a normal Windows computer running Chrome
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        // The transaction data returned from INRDeals
        // (Using optional chaining ?. just in case the API response is empty)
        const transactions = response.data.result?.data || []; 

        if (transactions.length === 0) {
            return res.status(200).send("No new transactions to sync.");
        }

        // 3. Process each transaction and update Firestore
        const batch = db.batch();

        for (const trx of transactions) {
            // The subid is the Firebase UID we passed from the Android app
            const userId = trx.subid; 
            const transactionId = trx.id;
            const cashbackAmount = parseFloat(trx.commission); // The points they earned
            const status = trx.status; // e.g., 'pending', 'approved', 'rejected'

            if (!userId) continue; // Skip if no user ID is attached

            // Create a reference to the specific transaction document in Firestore
            const transactionRef = db.collection('transactions').doc(transactionId.toString());

            // Save the transaction record to the ledger
            batch.set(transactionRef, {
                userId: userId,
                amount: cashbackAmount,
                status: status,
                store: trx.store_name,
                // Updated timestamp method for the new modular API
                date: FieldValue.serverTimestamp() 
            }, { merge: true });
        }

        // Commit all database updates at once
        await batch.commit();
        console.log("Sync complete!");
        
        res.status(200).send(`Successfully synced ${transactions.length} transactions.`);

    } catch (error) {
        console.error("Error syncing with INRDeals:", error);
        res.status(500).send("Failed to sync transactions.");
    }
});

// 4. Start the Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`LootBack Backend is running on port ${PORT}`);
});