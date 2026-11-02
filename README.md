# Examly — AI mock tests

One Next.js App Router application contains the responsive UI and all `/api` routes. There is no separate backend service. MongoDB stores users, tests, attempts, and temporary PDF chunks. Gemini extracts questions and answers from PDFs.

## Local setup

1. Install Node.js 22+ and run `npm ci`.
2. Copy `.env.example` to `.env.local` and set `MONGODB_URI`, a random `JWT_SECRET` of at least 32 characters, and `GEMINI_API_KEY`.
3. Run `npm run dev` and open `http://localhost:3000`.

`GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`. If Google returns a temporary 503 error, the app makes one fallback call to `gemini-3.1-flash-lite`. `GEMINI_API_KEY_FALLBACK` is optional and is used only after a 429 quota error. A second key from the same Google Cloud project shares the same quota.

## Deploy to Vercel

Import this repository as a Next.js project with the repository root as the project root. Set these environment variables in Vercel before deploying:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | MongoDB Atlas connection string reachable from Vercel |
| `JWT_SECRET` | Random secret with at least 32 characters |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `GEMINI_MODEL` | Optional; defaults to `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY_FALLBACK` | Optional key from a different Cloud project |

The `.env.local` file is ignored by Git and is not sent to Vercel. Configure Atlas network access and a database user for the Vercel environment. The PDF parser and worker are included in the Next.js server trace. The API route allows up to 300 seconds for extraction on Vercel plans that support this duration.

PDFs up to 15 MB are uploaded in 3 MB requests, below Vercel's 4.5 MB request body limit. Chunks are stored in MongoDB and removed after successful extraction or test deletion. Failed extraction retains the chunks so the user can retry from preview. Incomplete uploads can be resumed while the original file is still selected; otherwise create a new upload and delete the incomplete test.

## Test workflow

Register or log in → upload a PDF → review extracted MCQs → start a timed test → answer all questions on one page → submit or let the timer expire → review score and explanations. If no answer key is present, Gemini solves the questions and flags uncertain answers. The answer key stays on the server until submission.

Scoring: **+1 correct, −0.25 incorrect, 0 skipped**. Final marks are correct count minus 0.25 times incorrect count. Accuracy is correct divided by attempted questions. The server enforces the deadline and stores the final result.

## API

All responses are `{ "data": ... }` or `{ "error": "..." }`. Protected endpoints require `Authorization: Bearer <token>`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Log in |
| GET | `/api/auth/me` | Current user |
| POST | `/api/tests/upload` | Create upload using JSON `title`, `duration`, `originalPdfName`, `fileSize`, `chunkCount` |
| PUT | `/api/tests/:id/chunks/:index` | Upload one binary PDF chunk, up to 3 MB |
| GET | `/api/tests/:id/chunks` | List stored chunk indexes for recovery |
| POST | `/api/tests/:id/process` | Extract questions from stored chunks |
| GET | `/api/tests` | List own tests |
| GET | `/api/tests/:id` | Preview without answers |
| PATCH | `/api/tests/:id/questions` | Remove indexed questions before attempting |
| DELETE | `/api/tests/:id` | Delete a test, its attempts, and PDF chunks |
| POST | `/api/attempts/start` | Start or resume an attempt |
| GET | `/api/attempts/:id` | Attempt state |
| PATCH | `/api/attempts/:id/answer` | Save an answer |
| POST | `/api/attempts/:id/submit` | Grade on the server |
| GET | `/api/attempts/:id/result` | Result and answer review |
| GET | `/api/attempts/history` | Completed attempts |
| GET | `/api/analytics/dashboard` | Analytics |
| GET | `/api/health` | Health check |

## Limits

Gemini free tier quotas and model availability depend on the Google Cloud project. A normal text PDF uses one Gemini request per roughly 15,000 characters; scanned PDFs add an OCR request. Large PDFs or temporary Gemini congestion can exceed the available function duration, in which case the user can retry extraction. AI generated answers should be reviewed before use in a high stakes exam.
