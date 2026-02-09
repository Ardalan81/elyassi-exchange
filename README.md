# Elyassi Exchange 

## Description

Elyassi Exchange is a public-facing concept website for a currency exchange appointment system. It lets visitors book an appointment by selecting a date and time, upload identification, and receive an email confirmation with reschedule/cancel links. The site also includes a live exchange-rate board and a simple “Find My Appointment” lookup by email. This is a concept project for UI/UX and front-end logic, not a real service.

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
