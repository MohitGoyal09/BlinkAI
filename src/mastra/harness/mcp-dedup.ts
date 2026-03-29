/**
 * MCP ↔ Composio deduplication filter.
 *
 * Composio covers 900+ integrations. When a user adds an MCP server
 * that duplicates a Composio toolkit, we filter it out so the agent
 * doesn't see duplicate tools.
 *
 * Only truly external MCP servers (not covered by Composio) are kept.
 *
 * The slug list is sourced from the Composio /api/v1/apps endpoint.
 */

/**
 * Known Composio app slugs (lowercase).
 * Any MCP server whose name matches one of these is a duplicate
 * and should be filtered out — Composio already handles it.
 *
 * Full list fetched from Composio API (981 apps as of 2026-03).
 */
const COMPOSIO_COVERED_SERVICES = new Set([
  // Email & Communication
  'gmail', 'outlook', 'sendgrid', 'mailchimp', 'slack', 'slackbot', 'discord', 'discordbot',
  'microsoft_teams', 'teams', 'twilio', 'intercom', 'zendesk', 'brevo', 'mailerlite',
  'mailercloud', 'mailersend', 'sendbird', 'sender', 'sendfox', 'sendlane', 'sendloop',
  'sendspark', 'mailbluster', 'mailboxlayer', 'mailcheck', 'mailcoach', 'mails_so',
  'mailsoftly', 'mailtrap', 'emailable', 'emaillistverify', 'emailoctopus', 'emelia',
  'moosend', 'msg91', 'smtp2go', 'postmark', 'resend', 'reply', 'reply_io',
  'omnisend', 'campaign_cleaner', 'campayn', 'benchmark_email', 'customer_io', 'customerio',
  'remarkety', 'esputnik', 'pushbullet', 'pushover', 'onesignal_rest_api', 'onesignal_user_auth',
  'telegram', 'whatsapp', 'waboxapp', 'wati', 'whautomate',
  // Calendar & Scheduling
  'googlecalendar', 'google_calendar', 'calendar', 'calendly', 'cal', 'calendarhero',
  'scheduleonce', 'supersaas', 'planyo_online_booking', 'etermin',
  // Code & Dev Tools
  'github', 'gitlab', 'bitbucket', 'jira', 'linear', 'asana', 'trello', 'clickup',
  'notion', 'confluence', 'vercel', 'netlify', 'shortcut', 'monday', 'monday_mcp',
  'buildkite', 'circleci', 'codacy', 'codemagic', 'gitea', 'hashnode', 'render',
  'sourcegraph', 'swaggerhub', 'docker_hub', 'npm', 'postman', 'prisma', 'turso',
  'neon', 'appveyor', 'blazemeter', 'bugbug', 'bugherd', 'bugsnag', 'sentry',
  'datadog', 'new_relic', 'grafbase', 'nocodb', 'baserow', 'deplothq', 'deployhq',
  'fly', 'ngrok', 'northflank', 'processstreet', 'process_street',
  // Cloud & Storage
  'googledrive', 'google_drive', 'dropbox', 'one_drive', 'onedrive', 'box', 's3', 'aws',
  'share_point', 'egnyte', 'files_com', 'uploadcare', 'cloudinary', 'imagekit_io',
  'bunnycdn', 'cloudflare', 'cloudflare_api_key', 'cloudflare_browser_rendering',
  'digital_ocean', 'firebase', 'supabase',
  // CRM & Sales
  'salesforce', 'salesforce_service_cloud', 'hubspot', 'pipedrive', 'zoho', 'zoho_bigin',
  'zoho_books', 'zoho_desk', 'zoho_inventory', 'zoho_invoice', 'zoho_mail',
  'freshdesk', 'freshbooks', 'freshservice', 'close', 'capsule_crm', 'nethunt_crm',
  'pipeline_crm', 'salesflare', 'salesmate', 'attio', 'affinity', 'folk', 'kommo',
  'nutshell', 'copper', 'insightly', 'agiled', 'apollo', 'leadiq', 'leadfeeder',
  'leadboxer', 'rocket_reach', 'wiza', 'getprospect', 'hunter', 'tomba',
  'bettercontact', 'clearout', 'fullenrich', 'peopledatalabs', 'icypeas', 'piloterr',
  'phantombuster', 'instantly',
  // Search & Data
  // IMPORTANT: Keep Exa MCP available for deep web research workflows.
  // We intentionally do NOT dedup 'exa' so users can rely on their configured Exa MCP server.
  'tavily', 'tavily_mcp', 'serpapi', 'serpdog', 'serphouse', 'serply',
  'google_search_console', 'search_api', 'brave_search', 'bravesearch',
  'semrush', 'ahrefs', 'similarweb_digitalrank_api', 'builtwith', 'diffbot',
  'algolia', 'elasticsearch', 'pinecone', 'meilisearch',
  // Social Media
  'twitter', 'x', 'facebook', 'instagram', 'linkedin', 'reddit', 'youtube',
  'tiktok', 'spotify', 'smugmug', 'pexels', 'giphy', 'ayrshare', 'typefully',
  'toneden', 'postiz_mcp',
  // Payments & Finance
  'stripe', 'paypal', 'shopify', 'square', 'paystack', 'plisio', 'payhip',
  'gumroad', 'lemon_squeezy', 'quaderno', 'taxjar', 'flutterwave', 'brex', 'ramp',
  'quickbooks', 'xero', 'freeagent', 'moneybird', 'sevdesk', 'lexoffice', 'wave',
  // Documents & Productivity
  'googledocs', 'google_docs', 'googlesheets', 'google_sheets', 'googleslides',
  'googletasks', 'googlemeet', 'googlephotos', 'airtable', 'coda', 'basecamp',
  'wrike', 'todoist', 'ticktick', 'toggl', 'clockify', 'harvest', 'everhour',
  'timecamp', 'timely', 'wakatime', 'desktime', 'slite', 'miro', 'mural',
  'figma', 'canva', 'loomio', 'fibery', 'productboard', 'nozbe_teams',
  'heyy', 'loops_so', 'canny', 'beamer',
  // AI & ML
  'openai', 'anthropic', 'anthropic_administrator', 'mistral_ai', 'deepseek',
  'groqcloud', 'ollama', 'openrouter', 'replicate', 'cohere', 'hugging_face',
  'google_analytics', 'mixpanel', 'segment', 'posthog', 'amplitude',
  'fal_ai', 'elevenlabs', 'deepgram', 'runpod', 'e2b', 'stack_ai',
  'langbase', 'mem0', 'vectorshift', 'humanloop', 'promptmate_io',
  // CMS & Website
  'webflow', 'wix', 'wix_mcp', 'wordpress', 'contentful', 'contentful_graphql',
  'prismic', 'storyblok', 'plasmic', 'bubble', 'softr', 'ghost',
  'kontent_ai', 'agility_cms',
  // Project Management
  'teamcamp', 'leiga', 'rocketlane', 'workable', 'workday', 'workiom',
  'lever', 'recruitee', 'bamboohr', 'personio', 'talenthr',
  'jobnimbus', 'ashby', 'hackerrank_work',
  // Forms & Surveys
  'typeform', 'jotform', 'tally', 'formsite', 'formcarry', 'formbricks',
  'formdesk', 'fillout_forms', 'survey_monkey', 'getform', 'byteforms',
  // Signing & Documents
  'docusign', 'docuseal', 'pandadoc', 'boldsign', 'signwell', 'signaturely',
  'signpath', 'esignatures_io', 'eversign', 'oksign',
  // Support & Helpdesk
  'helpdesk', 'helpwise', 'gorgias', 'supportbee', 're_amaze', 'respond_io',
  'engage', 'missive', 'plain', 'gleap', 'delighted', 'retently',
  'satismeter', 'simplesat',
  // SMS & Messaging
  'clicksend', 'telnyx', 'sms_alert', 'dialmycalls', 'dialpad',
  // E-commerce
  'seat_geek', 'loyverse', 'storeganise', 'storerocket', 'rentman',
  'booqable', 'bigmailer',
  // Automation & Integration
  'zapier', 'make', 'ifttt', 'pagerduty', 'svix', 'hookdeck',
  'rudderstack_transformation', 'nango', 'parallel',
  // Misc tools & services
  'composio', 'composio_search', 'browser_tool', 'browserbase_tool', 'browserless',
  'browseai', 'firecrawl', 'scrapfly', 'scrapingant', 'scrapingbee', 'scrape_do',
  'scrapegraph_ai', 'webscraper_io', 'webscraping_ai', 'parsera', 'parseur', 'parsio_io',
  'apify', 'apify_mcp', 'agentql', 'anchor_browser', 'hyperbrowser',
  'brightdata', 'smartproxy', 'zenrows', 'zyte_api',
  'codeinterpreter', 'cursor', 'v0',
  'twocaptcha', 'remove_bg', 'tinypng', 'imgbb', 'screenshotone', 'screenshot_fyi',
  'lob', 'stannp', 'docupost',
  'notion', 'mem', 'roboflow', 'scale_ai', 'labelbox',
  'virustotal', 'securitytrails', 'abuselpdb',
  'openweather_api', 'ambee', 'stormglass_io', 'weathermap', 'solcast',
  'wolfram_alpha_api', 'nasa', 'alpha_vantage', 'coinmarketcap', 'coinbase',
  'twelve_data', 'polygon', 'finage', 'eodhd_apis', 'nasdaq',
  'news_api', 'hackernews', 'perigon',
  'pexels', 'giphy', 'unsplash',
  'mapbox', 'here', 'tomtom', 'google_maps', 'geoapify', 'geocodio',
  'ip2location', 'ipinfo_io', 'ipdata_co',
  'pdf_co', 'pdf4me', 'pdf_api_io', 'api2pdf', 'pdfmonkey', 'pdfless',
  'convertapi', 'cloudconvert', 'carbone',
  'snowflake', 'snowflake_basic', 'databricks', 'googlebigquery', 'metabase',
  'clickhouse', 'influxdb_cloud', 'kibana', 'xata',
  'jumpcloud', 'bitwarden',
  'zoominfo', 'zoom', 'webex', 'gong',
  'heygen', 'synthflow_ai', 'lmnt', 'vapi', 'retellai',
  'eventbrite', 'humanitix', 'sympla', 'eventee', 'eventzilla',
  'launch_darkly', 'split', 'statsig',
  'uptimerobot', 'pingdom', 'statuscake', 'better_stack',
  'doppler', 'doppler_marketing_automation',
  'active_campaign', 'active_trail', 'drip', 'klaviyo', 'kit',
  'lemlist', 'woodpecker_co', 'heyreach', 'persistiq', 'autobound',
  'tripadvisor', 'tripadvisor_content_api', 'yelp', 'foursquare',
  'strava', 'habitica',
  'netsuite', 'sap_successfactors', 'servicenow',
  'context7_mcp', 'deepwiki_mcp', 'devin_mcp', 'granola_mcp', 'tinyfish_mcp',
  'excel', 'googlesuper', 'googleads', 'metaads',
  'veo', 'dreamstudio', 'shotstack',
  'dub', 'short_io', 'cutt_ly', 'tinyurl',
]);

/**
 * Check if an MCP server name matches a known Composio integration.
 * Uses fuzzy matching: lowercased, stripped of common prefixes/suffixes.
 */
function isComposioCovered(mcpServerName: string): boolean {
  const normalized = mcpServerName
    .toLowerCase()
    .replace(/[-_\s]/g, '_')      // normalize separators
    .replace(/^mcp[_-]?/, '')     // strip "mcp-" or "mcp_" prefix
    .replace(/[_-]?server$/, '')  // strip "-server" suffix
    .replace(/[_-]?mcp$/, '');    // strip "-mcp" suffix

  // Direct match
  if (COMPOSIO_COVERED_SERVICES.has(normalized)) return true;

  // Also check without underscores (e.g., "googledrive" matches "google_drive")
  const noUnderscores = normalized.replace(/_/g, '');
  for (const service of COMPOSIO_COVERED_SERVICES) {
    if (service.replace(/_/g, '') === noUnderscores) return true;
  }

  return false;
}

/**
 * Filter out MCP toolsets that duplicate Composio integrations.
 * Returns only toolsets from MCP servers NOT covered by Composio.
 *
 * @param mcpToolsets - Raw MCP toolsets keyed by server name
 * @returns Filtered toolsets with duplicates removed
 */
export function filterComposioDuplicates(
  mcpToolsets: Record<string, Record<string, any>>
): Record<string, Record<string, any>> {
  const filtered: Record<string, Record<string, any>> = {};
  let removedCount = 0;

  for (const [serverName, tools] of Object.entries(mcpToolsets)) {
    if (isComposioCovered(serverName)) {
      removedCount++;
      console.log(`[mcp-dedup] Filtered MCP server "${serverName}" — Composio covers this integration`);
    } else {
      filtered[serverName] = tools;
    }
  }

  if (removedCount > 0) {
    console.log(`[mcp-dedup] Removed ${removedCount} duplicate MCP server(s), kept ${Object.keys(filtered).length} unique`);
  }

  return filtered;
}
