# Elyassi Exchange (Concept Website)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file (you can copy from `.env.example`) and add SMTP credentials.
   - Set `PUBLIC_BASE_URL` to your site URL so email links work.

3. Start the server:
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`.

## Notes

- Live rates use `RATES_API_URL` (default: open.er-api.com). Adjust to a local Iran source if desired.
- SMTP settings are required to send confirmation emails.
- Appointments and blocked dates are stored in `data/store.json`.
- Uploaded documents are stored in `uploads/`.
