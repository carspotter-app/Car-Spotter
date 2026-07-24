# Spotter — setup guide

## 1. Set up the database (Supabase)
1. Go to your Supabase project → **SQL Editor** → **New query**
2. Paste in everything from `supabase-schema.sql` in this folder
3. Click **Run**

This creates the `cars` table and locks it down so each person can only see and delete their own cars.

## 2. Get an Anthropic API key (the one paid piece)
1. Go to console.anthropic.com and sign up (this is separate from claude.ai)
2. Create an API key
3. Add a small amount of billing credit — car scans cost a fraction of a cent each

## 3. Put this project on GitHub
Create a new repository and upload all the files in this folder to it.

## 4. Deploy on Vercel
1. Go to vercel.com → sign in with GitHub → **Add New Project**
2. Select the repo you just created
3. Before deploying, add these **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL` → your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → your Supabase publishable key
   - `ANTHROPIC_API_KEY` → the key from step 2 (keep this one secret — never put it in the code itself)
4. Click **Deploy**

You'll get a live link like `spotter.vercel.app` that anyone can visit, sign up on, and start scanning cars.
