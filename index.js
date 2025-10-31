import express from 'express';
// Import and configure dotenv to load environment variables from the .env file
import * as dotenv from 'dotenv'; 
dotenv.config();

import cors from "cors";

const app = express();
// Use the PORT from .env, or default to 3000
const PORT = process.env.PORT || 3000; 

app.use(cors()); // Allow all origins

app.get('/', (req, res) => {
    res.send('Crop service is running');
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

/**
 * Helper function to retry a fetch call with exponential backoff.
 * @param {function} fetchFn - A function that returns a fetch Promise.
 * @param {number} maxRetries - The maximum number of retries.
 * @param {number} baseDelay - The base delay in ms.
 * @returns {Promise<Response>}
 */
async function fetchWithBackoff(fetchFn, maxRetries = 5, baseDelay = 1000) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            const response = await fetchFn();
            if (response.ok) {
                return response;
            }
            // Don't retry on client errors (4xx), but do on server errors (5xx)
            if (response.status >= 400 && response.status < 500) {
                throw new Error(`Client error: ${response.status} ${response.statusText}`);
            }
            // Handle specific rate-limiting error
            if (response.status === 429) {
                console.warn("Rate limited. Retrying with backoff...");
            } else {
                console.warn(`Server error: ${response.status}. Retrying with backoff...`);
            }
            
        } catch (error) {
            console.warn(`Fetch attempt ${attempt + 1} failed with error: ${error.message}. Retrying...`);
        }
        
        // Don't retry on the last attempt
        if (attempt === maxRetries - 1) {
            break;
        }

        const delay = baseDelay * Math.pow(2, attempt) + (Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
    }
    throw new Error("Failed to fetch from AI service after maximum retries.");
}

// Route to fetch AI data
app.get('/get-price/:name', async (req, res) => { 
    try {
        const { name } = req.params;

        // --- FIX: Check if the API key is loaded from .env ---
        if (!process.env.GEMINI_API_KEY) {
            console.error("GEMINI_API_KEY is not set in your .env file.");
            return res.status(500).send({ error: "Server configuration error: AI Key is missing." });
        }
        // --- End of Fix ---

        // Use the model that supports search grounding
        const modelName = "gemini-2.5-flash-preview-09-2025";
        
        // --- FIX: Use the API key from your environment variables ---
        const apiKey = process.env.GEMINI_API_KEY; 
        // --- End of Fix ---
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

        // --- MODIFICATION: Updated prompt to request JSON directly ---
        const systemPrompt = `You are an expert market data analyst. Your task is to find the current national average wholesale or mandi price for a given agricultural commodity in India.

You MUST respond with ONLY a valid JSON object string. Do not include \`\`\`json markdown delimiters, backticks, or any other explanatory text.
Your response must be ONLY the JSON object.

The JSON object must follow this exact format:
{
  "commodity": "string (the name of the commodity)",
  "price": number (the average price),
  "currency": "INR",
  "unit": "string (e.g., 'per kilogram' or 'per quintal')"
}`;
        
        const userQuery = `Find the current national average wholesale price for ${name} in India.`;

        // --- REMOVED: The 'schema' variable is no longer needed ---
        // const schema = { ... };

        const payload = {
            contents: [{ 
                role: "user",
                parts: [{ text: userQuery }] 
            }],
            systemInstruction: {
                parts: [{ text: systemPrompt }]
            },
            // CRITICAL: Enable Google Search for real-time data
            tools: [{ "google_search": {} }],
            generationConfig: {
                // --- REMOVED: responseMimeType and responseSchema ---
                // responseMimeType: "application/json",
                // responseSchema: schema,
                
                // Lower temperature for more factual, less "creative" responses
                temperature: 0.2 
            }
        };

        const fetchFn = () => fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        console.log(`Fetching price for: ${name}...`);
        
        const response = await fetchWithBackoff(fetchFn);
        const result = await response.json();

        const candidate = result.candidates?.[0];
        
        if (candidate && candidate.content?.parts?.[0]?.text) {
            const jsonText = candidate.content.parts[0].text;
            console.log("AI Response (Raw JSON Text):", jsonText);
            
            try {
                // --- FIX: Clean the AI response to remove markdown backticks ---
                // Find the first '{' and the last '}'
                const startIndex = jsonText.indexOf('{');
                const endIndex = jsonText.lastIndexOf('}');
                
                if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
                    throw new Error("Valid JSON object not found in AI response.");
                }
                
                // Extract the JSON string
                const cleanedJsonText = jsonText.substring(startIndex, endIndex + 1);
                // --- End of Fix ---

                // The model's response part is a *string* of JSON, so we parse it.
                const parsedJson = JSON.parse(cleanedJsonText); // Parse the *cleaned* string
                
                // Send the structured JSON data back to the client
                res.status(200).json(parsedJson);

            } catch (parseError) {
                console.error("Failed to parse JSON response from AI:", parseError.message);
                console.error("Raw text was:", jsonText);
                res.status(500).send({ error: "Failed to parse AI response." });
            }
        } else {
            console.error("Invalid AI response structure:", JSON.stringify(result, null, 2));
            res.status(500).send({ error: "AI service returned an invalid response." });
        }

    } catch (error) {
        // Handle any errors from the fetch/backoff process
        console.error("Gemini API Error:", error.message);
        res.status(500).send({ error: "Failed to get response from AI service.", details: error.message });
    }
});

app.listen(PORT, () => {
    // Show which port the service is running on, pulling from the variable
    console.log(`✅ Crop service running on port ${PORT}`);
});




