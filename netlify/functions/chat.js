// Use ES module imports instead of require
import { OpenAI } from "openai";
import fs from "fs";
import path from "path";
import { Readable } from 'stream';
import 'dotenv/config'; // Use this for ES modules

// --- Initialization ---

// Initialize OpenAI client
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Load instructions from file
let INSTRUCTIONS;
try {
    // In Netlify functions, __dirname is not available. Use process.cwd()
    const instructionsPath = path.resolve(process.cwd(), "instructions.txt");
    INSTRUCTIONS = fs.readFileSync(instructionsPath, "utf-8");
} catch (e) {
    console.error("Could not read instructions.txt:", e);
    INSTRUCTIONS = "You are a helpful assistant.";
}

const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID;
if (!VECTOR_STORE_ID) {
    console.warn("VECTOR_STORE_ID is not set. File search will be disabled.");
}

// --- Netlify Function Handler (Modern API) ---
// The handler now uses the standard Request and a Netlify-specific context object.
export default async (request, context) => {
    // We only care about POST requests
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { message, previous_response_id } = await request.json();

        if (!message) {
            return new Response(JSON.stringify({ error: "Message is required" }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const createStream = async (id) => {
            return client.responses.create({
                model: "gpt-5.4-nano",
                instructions: INSTRUCTIONS,
                input: [{ role: "user", content: message }],
                reasoning: { effort: "low" },
                previous_response_id: id || undefined,
                tools: VECTOR_STORE_ID ? [{
                    type: "file_search",
                    vector_store_ids: [VECTOR_STORE_ID]
                }] : [],
                stream: true,
            });
        };

        let stream;
        try {
            // First attempt: try to continue the conversation
            stream = await createStream(previous_response_id);
        } catch (e) {
            // If the conversation context is not found, retry without it
            if (e.code === 'previous_response_not_found') {
                console.warn("Previous response ID not found. Starting a new conversation.");
                stream = await createStream(null); // This starts a new conversation
            } else {
                // For any other error, re-throw it to be caught by the main handler
                throw e;
            }
        }

        // Use a transform stream to format the data as Server-Sent Events (SSE)
        const readable = Readable.from((async function* () {
            for await (const event of stream) {
                // The event structure from the openai-node library is already JSON-like.
                // We just need to wrap it in the "data: ...\n\n" format for SSE.
                const sseData = `data: ${JSON.stringify(event)}\n\n`;
                yield sseData;
                if (event.type === 'response.completed' || event.type === 'response.failed') {
                    break; // Stop listening but allow stream to close gracefully
                }
            }
        })());

        // For streaming, we return a Response object with the stream as the body.
        return new Response(readable, {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (e) {
        console.error("An unexpected error occurred:", e);
        return new Response(JSON.stringify({
            error: "An unexpected server error occurred."
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}; 