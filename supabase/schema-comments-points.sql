-- ==========================================
-- GALLERY 4.0: COMMENTS & POINTS SYSTEM
-- ==========================================

-- 1. PROMPT COMMENTS TABLE
-- Stores user comments on prompts with nesting support
CREATE TABLE IF NOT EXISTS public.prompt_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_id BIGINT REFERENCES public.prompts(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) > 0),
  parent_id UUID REFERENCES public.prompt_comments(id) ON DELETE CASCADE, -- For nested replies
  like_count INTEGER DEFAULT 0,
  is_pinned BOOLEAN DEFAULT false, -- For "featured" comments
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for comments
ALTER TABLE public.prompt_comments ENABLE ROW LEVEL SECURITY;

-- Policies for comments
CREATE POLICY "Comments are viewable by everyone" 
  ON public.prompt_comments FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert comments" 
  ON public.prompt_comments FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update own comments" 
  ON public.prompt_comments FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own comments" 
  ON public.prompt_comments FOR DELETE USING (auth.uid() = user_id);


-- 2. USER POINTS TABLE
-- Stores the current points balance for each user
CREATE TABLE IF NOT EXISTS public.user_points (
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE PRIMARY KEY,
  balance INTEGER DEFAULT 0 CHECK (balance >= 0),
  total_earned INTEGER DEFAULT 0, -- Lifetime earnings stats
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for points
ALTER TABLE public.user_points ENABLE ROW LEVEL SECURITY;

-- Policies for points
CREATE POLICY "Users can view own points" 
  ON public.user_points FOR SELECT USING (auth.uid() = user_id);

-- 3. POINTS LEDGER (Transaction History)
-- Immutable record of every point change
CREATE TABLE IF NOT EXISTS public.points_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  amount INTEGER NOT NULL, -- Positive for earn, negative for spend
  reason TEXT NOT NULL, -- e.g., 'comment_reward', 'unlock_prompt', 'daily_checkin'
  reference_id TEXT, -- e.g., Comment UUID or Prompt UUID
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for ledger
ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ledger" 
  ON public.points_ledger FOR SELECT USING (auth.uid() = user_id);


-- 4. PROMPT UNLOCKS
-- Tracks which users have unlocked which prompts
CREATE TABLE IF NOT EXISTS public.prompt_unlocks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  prompt_id BIGINT REFERENCES public.prompts(id) ON DELETE CASCADE NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  cost INTEGER DEFAULT 0,
  UNIQUE(user_id, prompt_id) -- Prevent double unlocking
);

-- Enable RLS for unlocks
ALTER TABLE public.prompt_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own unlocks" 
  ON public.prompt_unlocks FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert unlocks" 
  ON public.prompt_unlocks FOR INSERT WITH CHECK (auth.role() = 'authenticated');


-- 5. TRIGGER: Update User Points on Ledger Insert
-- Automatically updates user_points.balance when a ledger entry is made
CREATE OR REPLACE FUNCTION public.handle_points_update() 
RETURNS TRIGGER AS $$
BEGIN
  -- Insert or update the user_points record
  INSERT INTO public.user_points (user_id, balance, total_earned)
  VALUES (
    NEW.user_id, 
    GREATEST(0, NEW.amount), -- Initial balance if new row
    CASE WHEN NEW.amount > 0 THEN NEW.amount ELSE 0 END
  )
  ON CONFLICT (user_id) DO UPDATE
  SET 
    balance = public.user_points.balance + NEW.amount,
    total_earned = CASE 
      WHEN NEW.amount > 0 THEN public.user_points.total_earned + NEW.amount 
      ELSE public.user_points.total_earned 
    END,
    updated_at = NOW();
    
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_ledger_insert
  AFTER INSERT ON public.points_ledger
  FOR EACH ROW EXECUTE PROCEDURE public.handle_points_update();

-- 6. RPC: UNLOCK PROMPT TRANSACTION
-- Atomic function to handle point deduction and unlocking
CREATE OR REPLACE FUNCTION public.unlock_prompt(p_prompt_id BIGINT, p_cost INTEGER)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_balance INTEGER;
BEGIN
  v_user_id := auth.uid();
  
  -- Check user balance
  SELECT balance INTO v_balance FROM public.user_points WHERE user_id = v_user_id;
  
  IF v_balance IS NULL OR v_balance < p_cost THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient points');
  END IF;
  
  -- Check if already unlocked
  IF EXISTS (SELECT 1 FROM public.prompt_unlocks WHERE user_id = v_user_id AND prompt_id = p_prompt_id) THEN
    RETURN jsonb_build_object('success', true, 'message', 'Already unlocked');
  END IF;

  -- 1. Deduct points (via ledger)
  INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
  VALUES (v_user_id, -p_cost, 'unlock_prompt', p_prompt_id::text);
  
  -- 2. Record unlock
  INSERT INTO public.prompt_unlocks (user_id, prompt_id, cost)
  VALUES (v_user_id, p_prompt_id, p_cost);
  
  RETURN jsonb_build_object('success', true, 'new_balance', v_balance - p_cost);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
