import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import router from './routes';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Fix: Allow specific origin or all for dev
app.use(cors({
    origin: true, // Allow all origins for simplicity in this dev environment
    credentials: true
}));

app.use(express.json());

app.use('/api', router);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

export default app;
