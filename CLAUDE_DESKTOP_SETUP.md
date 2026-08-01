# Using Your Combos in Claude Desktop

## Overview
Your AI Provider Hub gateway can be used as a custom provider in Claude Desktop, allowing you to use your custom model combos alongside regular models.

## Setup Steps

### 1. Generate Gateway API Key

1. Open your deployed app: `https://your-domain.vercel.app`
2. Navigate to **Gateway API Keys** page
3. Click **Create New Key**
4. Label it as "Claude Desktop" (or any name)
5. **Copy the generated key** (starts with `ah-...`)
   - ⚠️ Save it securely - it won't be shown again!

### 2. Configure Claude Desktop

#### Add Custom Provider

1. Open **Claude Desktop**
2. Go to **Settings/Preferences**
3. Find **Custom Providers** or **API Configuration**
4. Click **Add Provider**

#### Provider Configuration

```
Provider Name: AI Provider Hub
Base URL: https://your-domain.vercel.app/api/v1
API Key: ah-your-generated-key-here
Format: OpenAI Compatible
```

### 3. Model Discovery

Claude Desktop will automatically fetch models from your gateway:

1. Go to **Settings → Model Discovery**
2. Click **Refresh Models** for your custom provider
3. Wait for discovery to complete

### 4. Available Models

After discovery, you'll see:

```
Model Picker:
├─ OpenRouter (if configured)
│  ├─ auto/claude-opus
│  └─ antigravity/claude-sonnet-5
│
├─ AI Provider Hub (Your Gateway)
│  ├─ smart-router          ← Your Custom Combo!
│  ├─ fast-fallback         ← Your Custom Combo!
│  ├─ aip/claude-opus-4     ← Claude models
│  ├─ gemini-1.5-pro        ← Google models
│  └─ ... (all your saved models)
```

## How Combos Work

When you select a combo (e.g., `smart-router`):

1. Gateway tries the **first model** in the combo
2. If it fails (401/403/429/5xx), tries the **next model**
3. Returns response from first successful model
4. All fallbacks happen automatically - no manual intervention needed

## Example Combo Setup

### Creating a Smart Router Combo

1. Go to **Combos** page in your app
2. Click **New Combo**
3. Configure:
   ```
   Name: smart-router
   Description: Fast model with quality fallback
   
   Members (in order):
   1. aip/claude-sonnet-3.5    (fast, cheap)
   2. aip/claude-opus-4         (slower, best quality)
   3. gemini-1.5-pro           (backup if Claude fails)
   ```
4. Save combo

### Using in Claude Desktop

1. Select `smart-router` from model picker
2. Send your message
3. Gateway automatically:
   - Tries Claude Sonnet first
   - Falls back to Opus if Sonnet fails
   - Falls back to Gemini if both Claude models fail

## Troubleshooting

### Combo Not Showing in Claude Desktop

**Check:**
1. Gateway API key is valid (test with curl)
2. Combo has a valid name (non-empty, lowercase)
3. Combo has at least one member model
4. Claude Desktop successfully refreshed models

**Test Your Gateway:**
```bash
curl https://your-domain.vercel.app/api/v1/models \
  -H "Authorization: Bearer ah-your-key" | jq
```

Should return:
```json
{
  "object": "list",
  "data": [
    {"id": "aip/claude-opus-4", "object": "model", "owned_by": "anthropic"},
    {"id": "smart-router", "object": "model", "owned_by": "combo"},
    ...
  ]
}
```

### Combo Returns Error

**Common Issues:**
- Provider API key is missing/invalid
- Model ID mismatch (check saved models)
- All fallback models failed

**Check Gateway Logs:**
- Vercel Dashboard → Your Project → Functions → Logs
- Look for error messages about model routing

### Model Not Available Error

If you see: `Model isn't available (aip/claude-opus)`

**Solution:**
1. Check the model is saved in your app
2. Verify provider is connected with valid API key
3. Test provider connection in Providers page
4. Re-save the model if needed

## Advanced Usage

### Multiple Combos for Different Use Cases

**Speed-Focused:**
```
Name: ultra-fast
Members:
1. gemini-1.5-flash
2. aip/claude-sonnet-3.5
```

**Quality-Focused:**
```
Name: best-quality
Members:
1. aip/claude-opus-4
2. gemini-1.5-pro
3. aip/claude-sonnet-3.5
```

**Cost-Optimized:**
```
Name: budget-friendly
Members:
1. gemini-1.5-flash
2. gemini-1.5-pro
```

### Regional Fallback

```
Name: multi-region
Members:
1. aip/claude-opus-4        (US provider)
2. aip/claude-opus-4        (EU provider - different API key)
3. gemini-1.5-pro          (global backup)
```

## Security Notes

- ⚠️ **Keep your `ah-` key secure** - it gives access to ALL your connected providers
- 🔒 **Don't commit keys** to version control
- 🔄 **Rotate keys regularly** (revoke old, create new)
- 📊 **Monitor usage** in Gateway API Keys page

## Support

For issues or questions:
- Check Vercel deployment logs
- Review provider connection status
- Test individual models before adding to combo
- Ensure all providers have valid API keys

---

**Last Updated:** 2026-08-01
