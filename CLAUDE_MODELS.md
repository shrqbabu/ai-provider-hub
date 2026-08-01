# Common Claude Models to Add Manually

Since Anthropic doesn't expose a `/models` endpoint, you need to add Claude models manually.

## Latest Claude Models (as of 2026-08-01)

### Claude 3.5 Family
```
claude-3-5-sonnet-20241022    // Latest Sonnet
claude-3-5-haiku-20241022     // Latest Haiku
```

### Claude 3 Family
```
claude-3-opus-20240229
claude-3-sonnet-20240229
claude-3-haiku-20240307
```

### Claude 4 Family (if available)
```
claude-4-opus
claude-4-sonnet
claude-4-haiku
```

## How to Add These Models

1. Go to **Providers** page in your app
2. Edit your Anthropic provider
3. Scroll to **Models** section
4. Click **Add Model Manually**
5. Enter the model ID (e.g., `claude-3-5-sonnet-20241022`)
6. Optionally set:
   - Display name: "Claude 3.5 Sonnet"
   - Context length: 200000
   - Vision support: Yes
7. Click **Save**

## After Adding

The model will appear in the gateway's `/v1/models` list as:
```
aip/claude-3-5-sonnet-20241022
aip/claude-3-5-haiku-20241022
...
```

## Claude Desktop Usage

Once added, these models will be available in Claude Desktop when you:
1. Configure your gateway as a custom provider
2. Refresh the model list

## Error: "Could not route model"

If you see this error, it means:
- ❌ Model is not saved in your app
- ❌ OR Provider is not connected
- ❌ OR Model ID doesn't match exactly

**Solution:**
1. Check the exact model ID in the error message
2. Go to your app and add that specific model ID
3. Refresh Claude Desktop's model list

## Getting Model IDs

Check Anthropic's documentation for the latest model IDs:
- https://docs.anthropic.com/en/docs/models-overview

Or check OpenRouter's model list (they often have the latest):
- https://openrouter.ai/models
