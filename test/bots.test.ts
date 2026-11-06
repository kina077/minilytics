import { describe, expect, it } from 'vitest';
import { botName, toHits } from '../src/worker/bots';

describe('botName', () => {
  it('names the bots Cloudflare reports for our site', () => {
    expect(botName('Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe('Googlebot');
    expect(botName('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116 Safari/537.36')).toBe('Bingbot');
    expect(botName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36; compatible; OAI-SearchBot/1.4; +https://openai.com/searchbot')).toBe('OAI-SearchBot');
    expect(botName('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot')).toBe('ChatGPT-User');
    expect(botName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)')).toBe('Applebot');
    expect(botName('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/119 Safari/537.36')).toBe('Amazon SearchBot');
    expect(botName('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe('Meta');
    expect(botName('Twitterbot/1.0')).toBe('Twitterbot');
    expect(botName('Mozilla/5.0 (compatible; ExaSearchBot/1.0; +https://crawler.exa.ai/)')).toBe('ExaSearchBot');
  });
});

describe('toHits', () => {
  const row = (host: string, ua: string, path: string, count: number) => ({
    count,
    dimensions: { clientRequestHTTPHost: host, userAgent: ua, verifiedBotCategory: 'Search Engine Crawler', clientRequestPath: path },
  });
  it('keeps only known sites, ignores www and merges versions of one bot', () => {
    const hits = toHits(
      [
        row('domaintoolbelt.com', 'compatible; OAI-SearchBot/1.4', '/drops', 2),
        row('www.domaintoolbelt.com', 'compatible; OAI-SearchBot/1.0', '/drops', 1),
        row('ml.domaintoolbelt.com', 'Twitterbot/1.0', '/e', 5),
      ],
      [{ id: 'dtb', domain: 'domaintoolbelt.com' }],
      0,
    );
    expect(hits).toEqual([{ site_id: 'dtb', hour: 0, bot: 'OAI-SearchBot', category: 'Search Engine Crawler', path: '/drops', hits: 3 }]);
  });
});
