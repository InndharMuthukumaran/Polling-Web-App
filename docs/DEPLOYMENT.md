# Deployment guide (Neon + Render + Vercel, all free tiers)

Do this **after** the D1 prompt is committed and pushed. Put this file in your repo as `docs/DEPLOYMENT.md`. Plan for about 45 minutes the first time.

You will create three things and connect them:

| Piece | Service | What it holds |
|---|---|---|
| Database | Neon | Your data |
| Backend (API) | Render | The FastAPI server |
| Web app | Vercel | The pages people open |

Write down each address as you go. You will paste them into each other.

## Step 1: Database on Neon

1. Sign in at neon.com and create a project. Pick a region close to you and to where you will put Render (Singapore is a good choice for India).
2. Open the project's **Connect** panel and copy the connection string. Prefer the **direct** one (the host name without `-pooler`); the pooled one usually works too. It looks like `postgresql://user:password@host/neondb?sslmode=require`.
3. Keep it secret. You will paste it into Render in Step 2. (After D1, you can use it as is: the app converts the start of the address itself.)

## Step 2: Backend on Render

1. Sign in at render.com with GitHub. Choose **New, Blueprint** and select your repository. Render reads `render.yaml` and proposes a free web service named for the backend.
   - If you prefer to do it by hand: **New, Web Service**, root directory `backend`, runtime Python, build command `pip install .`, start command `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check path `/health`, plan **Free**.
2. Fill in the environment variables when asked:
   - `DATABASE_URL`: the Neon connection string from Step 1 (no quotes).
   - `CORS_ORIGINS`: for now `http://localhost:5173`. You will change it in Step 4.
   - `TRUSTED_PROXY_COUNT`: `1` (already set by the blueprint). Without it, every visitor looks like one person to the rate limiter.
3. Deploy. The first build takes a few minutes. When it is live, open `https://YOUR-SERVICE.onrender.com/health`. You should see `{"status":"ok"}`. Then open `/health/db` to confirm the database connection.
4. Copy the service address (no trailing slash).

## Step 3: Web app on Vercel

1. Sign in at vercel.com with GitHub. **Add New, Project**, import the repository.
2. Set **Root Directory** to `frontend`. The framework should be detected as Vite (build command `npm run build`, output `dist`).
3. Add the environment variable `VITE_API_BASE_URL` with the Render address from Step 2 (for example `https://YOUR-SERVICE.onrender.com`, no trailing slash).
4. Deploy and copy the address Vercel gives you, for example `https://your-app.vercel.app`.

Vercel's free plan is meant for personal, non-commercial use. Check its terms if you ever charge for the app.

## Step 4: Connect the two

1. Back in Render, open your service, **Environment**, and set `CORS_ORIGINS` to your exact Vercel address: `https://your-app.vercel.app` (https, no trailing slash, no spaces). To keep local development working too, separate several addresses with commas: `https://your-app.vercel.app,http://localhost:5173`.
2. Save. Render restarts the service.
3. Run the smoke test from your computer:

```powershell
python scripts/smoke_test.py --api https://YOUR-SERVICE.onrender.com --web https://your-app.vercel.app
```

Every line should say OK. It creates one test group called "SMOKE TEST (safe to delete)".

## Step 5: Keep the free backend awake

Render's free service falls asleep after about 15 minutes without traffic, and the next visitor then waits up to a minute. Reminders (a later part) also need the server awake.

1. Make a free account at a monitoring service such as UptimeRobot or cron-job.org.
2. Add a check that requests `https://YOUR-SERVICE.onrender.com/health` **every 5 minutes**. Use `/health`, not `/health/db`, so the database is not woken up on every ping.
3. One always-on free service uses about 744 of the 750 free hours a month, so this works for a single service only.

When you have real users, move the backend to a paid always-on plan (about $7 a month at the time of writing; check Render's pricing page).

## Step 6: Try it for real

1. Open your Vercel address on your laptop and create a group. Save the Group ID and Admin Token somewhere safe. There is no recovery.
2. Import a roster or add members, create a poll, and copy the poll link.
3. Send the poll link to a friend and have them open it on their phone. Check: they can claim a name, vote, and answer questions; you see the lists and results update.
4. Open a poll link directly in a new tab and press refresh. It should load (that is the Vercel rewrite working).

## If something goes wrong

| What you see | Likely cause and fix |
|---|---|
| Browser console says a request was blocked by CORS | `CORS_ORIGINS` on Render does not exactly match the Vercel address. Fix it, save, wait for the restart. |
| Pages work but every request fails or hangs | `VITE_API_BASE_URL` on Vercel is wrong or has a trailing slash. Fix it and **redeploy** (Vite reads it at build time). |
| First request after a quiet period takes a long time | The free backend was asleep. Set up Step 5. |
| `/health/db` fails, or the service does not start | `DATABASE_URL` is wrong, or the Neon project is paused. Check the Render logs. |
| A poll link shows a 404 page when opened directly | `frontend/vercel.json` is missing or Root Directory is not `frontend`. |
| "Too many attempts" for many members at once | `TRUSTED_PROXY_COUNT` is not `1` on Render. |
| Render logs show a migration error on start | Read the error in the logs; the service will not start until migrations succeed. |

## Keep these safe

- Never commit a `.env` file. Keep database passwords only in Render's environment settings.
- A roster with names and register numbers is personal data. Share the admin token with nobody you do not trust, and delete groups you no longer need (a delete feature is still to be built).
- Free tiers can change. Re-check Neon, Render and Vercel limits before relying on them for a real class.