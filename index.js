import express from 'express';
// Import and configure dotenv to load environment variables from the .env file
import * as dotenv from 'dotenv'; 
dotenv.config();

// import { cropRouter } from './routes/crop.js';
import { GoogleGenAI } from "@google/genai";


const app = express();
// Use the PORT from .env, or default to 3000
const PORT = process.env.PORT || 3000; 


import cors from "cors";
app.use(cors()); // Allow all origins

// 🎯 FIX: Fetch the API key securely from the environment variables
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }); 

// app.use(express.json());
// app.use('/api/crop', cropRouter);
app.get('/', (req, res) => {
    res.send('Crop service is running');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Route to fetch AI data
app.get('/get-price/:name', async (req, res) => { 
    try {

        const { name } = req.params;
        // Ensure the API key is actually loaded
        if (!process.env.GEMINI_API_KEY) {
            console.error("GEMINI_API_KEY is not set in environment variables.");
            return res.status(500).send({ error: "Server configuration error: AI Key missing." });
        }

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Search for the current national average wholesale or mandi price of ${name} in Indian Rupees per kilogram. The final output must be ONLY the price, formatted exactly as: '₹ X.X' (including the single quotes, with X.X being the average price rounded to one decimal place). DO NOT provide any other text, explanation, or formatting.`,
        });

        console.log("AI Response:", response.text);

        // Send the response text back to the client
        res.status(200).send({ explanation: response.text });

    } catch (error) {
        // Handle any errors from the Google GenAI API or network issues
        console.error("Gemini API Error:", error.message);
        res.status(500).send({ error: "Failed to get response from AI service.", details: error.message });
    }
});


app.listen(PORT, () => {
    // Show which port the service is running on, pulling from the variable
    console.log(`✅Crop service running on port ${PORT}`);
});