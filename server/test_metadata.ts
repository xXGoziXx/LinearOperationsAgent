
process.env.LINEAR_API_KEY = 'mock-key';
import { getTeamMetadata } from './src/linear';

async function run() {
    console.log("Testing getTeamMetadata...");
    try {
        const metadata = await getTeamMetadata('mock-team-id', { force: true });
        console.log("Success:", JSON.stringify(metadata, null, 2));
    } catch (e) {
        console.error("Failed:", e);
    }
}

run();
