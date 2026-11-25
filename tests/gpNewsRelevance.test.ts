import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  scoreArticleForTicker,
  matchTickerExact,
  normalizeCompanyName,
  isSyndicatedMarketReport,
  matchTokensWordBoundary,
  type NewsItemLike,
} from '../src/utils/gpNewsRelevance';

// Diagnostic 48-headline fixture collected from live Yahoo Finance / API diagnostic run
interface DiagnosticFixtureItem extends NewsItemLike {
  expectedScore: 0 | 1 | 2;
  diagnosticCategory: 'DIRECT' | 'RELATED' | 'UNRELATED';
  disagreementReason?: string;
}

const DIAGNOSTIC_FIXTURES: Record<string, DiagnosticFixtureItem[]> = {
  AAPL: [
    {
      title: 'Nvidia Chipmaker TSMC Sends $22.6 Billion AI Signal',
      source: 'GuruFocus.com / Yahoo Finance',
      content: 'Wedbush sees another sign that the AI spending boom remains intact.',
      relatedTickers: ['TSM', 'NVDA', 'AMD', 'AAPL', 'TSM'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'How Warren Buffett Makes Billions from Dividends: Top 10 Stocks',
      source: 'Insider Monkey / Yahoo Finance',
      content:
        'Warren Buffett and dividends are an old love story that continues to this day, as Berkshire’s latest 13F filing shows. The filing also reveals portfolio changes as CEO Greg Abel reshapes Berkshire’s stock holdings after succeeding Buffett in January as the…',
      relatedTickers: ['BRK-B', 'OXY', 'AAPL', 'CB', 'GOOG', 'KR'],
      expectedScore: 0,
      diagnosticCategory: 'RELATED',
      disagreementReason:
        'Diagnostic labeled RELATED because Apple is Berkshire’s largest dividend payer, but neither Apple nor AAPL is mentioned in title or snippet, and tag-only relatedTickers is dropped by rule.',
    },
    {
      title:
        'Top AI Spenders Pay Nearly $10K Monthly Per Worker. Typical Firm Pays $16. Cathie Wood Says, ‘That’s How Early We Are In This Cycle’',
      source: 'Benzinga / Yahoo Finance',
      content:
        'Quick Read The top 1% of AI spenders pay nearly $10,000 per employee monthly, while Ramp’s October median was $16.32. Cathie Wood expects productivity gains and falling AI costs to encourage broader adoption.',
      relatedTickers: ['RAMP.PVT', 'AAPL'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Alphabet Is Most Beat Down AI Company',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        'Search worries are old news for Alphabet. A shaky Apple deal, a rival chatbot gaining ground, and a massive data center bet are stacking new risks on Google, and the pile keeps growing.',
      relatedTickers: ['GOOGN', 'AAPL', 'GOOG', 'TSLA'],
      expectedScore: 2,
      diagnosticCategory: 'RELATED',
    },
    {
      title: 'The Next Big Healthcare Revolution Is Already Here. This Stock Could Cash In.',
      source: 'Motley Fool / Yahoo Finance',
      content: 'Quest Diagnostics runs the labs behind some of the hottest consumer health brands.',
      relatedTickers: ['DGX', 'AAPL', 'NVDA'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'The Zacks Analyst Blog Highlights Apple, Philip Morris, Intel and Crimson Wine',
      source: 'Zacks / Yahoo Finance',
      content:
        "Apple's expanding Services business, Philip Morris' smoke-free transition and Intel's manufacturing recovery and AI opportunities headline top analyst reports.",
      relatedTickers: ['AAPL', 'INTC', 'PM', 'CWGL'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title:
        'USA Rare Earth Drops 6% as China Extends Mineral Export Pause and New U.S. Tariffs Loom; Critical Metals Declines 5%, MP Materials Falls 3%',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        'Beijing eases its grip on critical minerals while Washington readies a tariff probe, and rare earth investors cannot tell which move matters more. Three very different companies face the same squeeze, and only one has real cash to ride it out.',
      relatedTickers: ['USAR', 'MP', 'AAPL', 'CRML', 'UAMY'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title:
        'Prediction: Qualcomm Becomes the Top Auto Chipmaker in 2027, “a Story the Market Has Quietly Ignored,” per SemiAnalysis',
      source: 'TIKR / Yahoo Finance',
      content:
        'Key Takeaways: Qualcomm’s (QCOM:NASDAQ) auto revenue reached $2 billion in its September quarter, up 89%, and SemiAnalysis predicts it will pass Infineon (IFNNY) and NXP Semiconductors (NXPI:NASDAQ) in 2027 to become the largest auto chipmaker. The growth…',
      relatedTickers: ['QCOM', 'NXPI', 'IFX.DE', 'AAPL'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title:
        'Market Chatter: Trump to Preside Over Taiwan Semiconductor Plant Expansion Ceremony in Arizona',
      source: 'MT Newswires / Yahoo Finance',
      content:
        'President Donald Trump will lead a groundbreaking ceremony on Dec. 4 for the expansion of a Taiwan S',
      relatedTickers: ['TSM', 'NVDA', 'AMD', 'AAPL'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: "Does Apple's New Silence Mean You Should Worry?",
      source: 'Trefis / Yahoo Finance',
      content: "Today's big story: Anthropic Below Its IPO Price: Do Giants Come Back.",
      relatedTickers: ['AAPL', 'MSFT', 'AMZN', 'GOOG'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: "Is Micron's Record Margin Squeezing Apple And HP?",
      source: 'Trefis / Yahoo Finance',
      content:
        'Micron Technology makes the memory chips inside PCs, phones and servers. Its gross margin is the share of sales left after the direct cost of making its chips.',
      relatedTickers: ['MU', 'HPQ', 'AAPL', 'DELL'],
      expectedScore: 1,
      diagnosticCategory: 'RELATED',
    },
    {
      title:
        'Social Buzz: Wallstreetbets Stocks Mostly Lower Premarket Wednesday; Dell Technologies, Sandisk to Decline',
      source: 'MT Newswires / Yahoo Finance',
      content: '',
      relatedTickers: ['DELL', 'SNDK', 'SPCX', 'AAPL', 'AMD', 'MU', 'NVDA', 'ET'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Proshares Trust (TQQQ) Sells Apple and Nvidia on Nov. 23',
      source: 'GuruFocus.com / Yahoo Finance',
      content:
        'The $27.74 billion fund sold $163.2 million of stock on Monday, trimming all 101 positions and adding none.',
      relatedTickers: ['AAPL', 'NVDA', 'MU', 'TQQQ', 'MSFT', 'AMZN'],
      expectedScore: 1,
      diagnosticCategory: 'UNRELATED',
      disagreementReason:
        'Diagnostic labeled UNRELATED because it is mechanical ETF trimming, but the company name "Apple" is prominent in the title so it correctly qualifies for Tier 1.',
    },
    {
      title: 'State Street SPDR Portfolio S&P 500 (SPYM) Buys $14.2 Million More Apple on Monday',
      source: 'GuruFocus.com / Yahoo Finance',
      content:
        'The fund added $174.1 million across 502 positions, led by Apple, Nvidia and Microsoft, with no sales.',
      relatedTickers: ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'GOOGN', 'SPYM'],
      expectedScore: 1,
      diagnosticCategory: 'RELATED',
    },
  ],

  GOOG: [
    {
      title: 'How Warren Buffett Makes Billions from Dividends: Top 10 Stocks',
      source: 'Insider Monkey / Yahoo Finance',
      content:
        'Warren Buffett and dividends are an old love story that continues to this day, as Berkshire’s latest 13F filing shows. The filing also reveals portfolio changes as CEO Greg Abel reshapes Berkshire’s stock holdings after succeeding Buffett in January as the…',
      relatedTickers: ['BRK-B', 'OXY', 'AAPL', 'CB', 'GOOG', 'KR'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: '3 High-Growth Stocks That Could Make $10,000 Worth Much More by 2030',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        "One chip maker's bull case dwarfs everything else here, yet its bear case barely beats breaking even. We ran $10,000 through Alphabet, Micron and MercadoLibre to see which Nasdaq bet carries the wildest swing.",
      relatedTickers: ['MU', 'GOOGN', 'MELI', 'GOOG', 'SOFI'],
      expectedScore: 2,
      diagnosticCategory: 'RELATED',
    },
    {
      title: 'Alphabet Is Most Beat Down AI Company',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        'Search worries are old news for Alphabet. A shaky Apple deal, a rival chatbot gaining ground, and a massive data center bet are stacking new risks on Google, and the pile keeps growing.',
      relatedTickers: ['GOOGN', 'AAPL', 'GOOG', 'TSLA'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Google Ends $75 Million News Deal Amid Regulatory Fight',
      source: 'GuruFocus.com / Yahoo Finance',
      content: 'The decision could reshape how technology companies fund journalism.',
      relatedTickers: ['GOOGN', 'GOOG'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Anthropic Loses Its $1 Trillion Market Value. So Much for the AI Hype.',
      source: 'Barrons.com / Yahoo Finance',
      content:
        'The AI lab was targeting a $2 trillion valuation in mid-October. The market has decided it’s only worth half that.',
      relatedTickers: ['ANT', 'GOOG', 'META'],
      expectedScore: 0,
      diagnosticCategory: 'RELATED',
      disagreementReason:
        'Diagnostic labeled RELATED due to Google’s large financial stake in Anthropic, but snippet/title mentions neither Google nor Alphabet, and tag-only relatedTickers is dropped.',
    },
  ],

  MSFT: [
    {
      title: 'Prediction: IREN’s Microsoft Deal Could Be Just the Beginning of Its Next Growth Phase',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        'IREN has dropped its Bitcoin mining roots and now owns the land, power, and data centers beneath its AI chips, yet the stock keeps sinking. What would it take for the market to finally notice, and could the price double?',
      relatedTickers: ['IREN', 'MSFT', 'BTC-USD', 'NVDA'],
      expectedScore: 1,
      diagnosticCategory: 'RELATED',
    },
    {
      title: 'Microsoft-Backed OpenAI Faces Another ChatGPT Setback',
      source: 'GuruFocus.com / Yahoo Finance',
      content: 'Paid subscribers face fresh trouble just days after an earlier disruption.',
      relatedTickers: ['MSFT'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Microsoft Stocks Fall 2.53% as Hyperscalers Join AI Selloff',
      source: 'GuruFocus.com / Yahoo Finance',
      content: 'Microsoft holds up better than its peers, backed by 48% Azure growth and a perfect GF Score.',
      relatedTickers: ['MSFT', 'GOOGN', 'AMZN'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Nasdaq slides 4% as AI selloff, tariff proposals rattle Wall St',
      source: 'Reuters / Yahoo Finance',
      content: '',
      relatedTickers: ['MRVL', 'ANT', 'NVDA', 'MU', 'AMD', 'GOOGN', 'AMZN', 'MSFT', 'META'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Stirlingshire Investments Appoints Daniel Gicklhorn as Chief Technology Officer',
      source: 'PR Newswire / Yahoo Finance',
      content:
        'Stirlingshire Investments today announced the appointment of Daniel Gicklhorn as Chief Technology Officer. Gicklhorn will lead technology strategy, architecture and engineering for Stirling ONE, the AI-native platform built to give independent advisors the…',
      relatedTickers: ['MSFT'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Nasdaq 100 on pace to enter bear market as AI trade melts down: AlphaCheck',
      source: 'Yahoo Finance',
      content: 'Stocks declined on Tuesday as the semiconductor sector retreated.',
      relatedTickers: ['SPCX', 'AMD', 'MSFT', 'NVDA', 'ANT'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Allstate suffers multi-day tech outage ahead of Thanksgiving',
      source: 'TechCrunch / Yahoo Finance',
      content:
        'The disruption comes at a particularly bad time for the insurance giant, as millions of Americans prepare to travel for the Thanksgiving holiday weekend.',
      relatedTickers: ['ALL', 'MSFT'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Bright Horizon utility lands Microsoft data center deals amid Wyoming buildout',
      source: 'Utility Dive / Yahoo Finance',
      content:
        'Cheyenne Light — with a 439-MW peak load record — is working on a 3-GW near-term data center pipeline, with an additional 2.5 GW in emerging opportunities, per company officials.',
      relatedTickers: ['MSFT'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title:
        'Alphabet, NVIDIA, Microsoft and AWS Lead the AI for Scientific Discovery Market as It Grows to USD 34.78 Billion by 2035',
      source: 'GlobeNewswire / Yahoo Finance',
      content:
        'Big Technology Platforms Hold ~38% Share While Schrödinger, Benchling, Recursion and Insilico Lead Specialists; Market Grows at 21.90% CAGR From USD 5.85 Billion in 2026: Precedence Research Company Share and Investment IntelligenceOttawa, Nov. 25, 2026…',
      relatedTickers: ['GOOGN', 'NVDA', 'MSFT'],
      expectedScore: 0,
      diagnosticCategory: 'RELATED',
      disagreementReason:
        'Diagnostic labeled RELATED due to enterprise market share mention, but it is dropped by the syndicated market-report rule (GlobeNewswire + "USD 34.78 Billion").',
    },
    {
      title:
        'Digital Twins in Healthcare Market to worth USD 101.19 Billion by 2031, at a CAGR of 68.4% – MarketsandMarkets™',
      source: 'GlobeNewswire / Yahoo Finance',
      content:
        'Delray Beach, FL , Nov. 25, 2026 (GLOBE NEWSWIRE) -- MarketsandMarkets™ projects the global digital twins in healthcare market to grow from USD 7.47 billion in 2026 to USD 101.19 billion by 2031, at a CAGR of 68.4%.',
      relatedTickers: ['SHL.DE', 'MSFT', 'PHG', 'DSY.PA'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Prediction: Meta Could Be One of the Biggest AI Winners Over the Next 5 Years',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        'Meta shed 17% in a month after a nine-figure legal charge and record spending plans spooked investors. Yet a new AI product is quietly drawing millions of users, and the valuation gap with rivals is hard to ignore.',
      relatedTickers: ['META', 'GOOGN', 'MSFT'],
      expectedScore: 0,
      diagnosticCategory: 'RELATED',
      disagreementReason:
        'Diagnostic labeled RELATED due to competitor comparison, but neither Microsoft nor MSFT appears in title or snippet, and tag-only relatedTickers is dropped.',
    },
    {
      title:
        'Software-Defined Networking and Network Function Virtualization Market Report 2026 | Secure $172.49B as Cisco, Microsoft, Huawei, HPE and Nokia Drive Cloud Automation by 2030',
      source: 'GlobeNewswire / Yahoo Finance',
      content:
        'Boost ROI with cloud-based SDN/NFV, centralized automation and scalable virtualized services to cut IT costs, optimize resources and improve application performance.Dublin, Nov. 25, 2026 (GLOBE NEWSWIRE) -- "Software-Defined Networking And Network Function…',
      relatedTickers: ['CSCO', 'MSFT', 'HPE', 'NOK'],
      expectedScore: 0,
      diagnosticCategory: 'RELATED',
      disagreementReason:
        'Diagnostic labeled RELATED due to cloud networking, but it is dropped by the syndicated market-report rule (GlobeNewswire + "Market Report 2026" / "by 2030").',
    },
    {
      title:
        'Global Risk Analysis Management Market Report 2026: Size, Share, Trends, and Forecast to 2030 | Capitalize on AI and Real-Time Risk with Microsoft, IBM, Oracle, SAP, and ServiceNow',
      source: 'GlobeNewswire / Yahoo Finance',
      content:
        'Boost ROI with AI-driven risk detection, real-time monitoring, integrated governance, proactive resilience planning, regulatory reporting and third-party risk visibility.Dublin, Nov. 25, 2026 (GLOBE NEWSWIRE) -- "Risk Analysis Management Market Global Report…',
      relatedTickers: ['MSFT', 'IBM', 'ORCL', 'SAP', 'NOW'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
  ],

  NVDA: [
    {
      title: 'Prediction: IREN’s Microsoft Deal Could Be Just the Beginning of Its Next Growth Phase',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        'IREN has dropped its Bitcoin mining roots and now owns the land, power, and data centers beneath its AI chips, yet the stock keeps sinking. What would it take for the market to finally notice, and could the price double?',
      relatedTickers: ['IREN', 'MSFT', 'BTC-USD', 'NVDA'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title:
        'Nvidia’s Biggest Advantage Could Become Its Biggest Weakness, Says Former Intel AI Chief',
      source: 'Benzinga Prediction Markets / Yahoo Finance',
      content:
        'Artificial intelligence has helped make Nvidia Corp. (NASDAQ:NVDA) one of the world’s most valuable companies, but could eventually undermine one of its biggest competitive advantages. Naveen Rao, the former head of Intel’s AI chip division, argues that…',
      relatedTickers: ['NVDA', 'INTC'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Nvidia’s Jensen Huang Should Do This 1 Thing Now',
      source: 'Motley Fool / Yahoo Finance',
      content: 'This one move could reassure investors.',
      relatedTickers: ['NVDA'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title:
        'Stock market today: Dow, S&P 500, Nasdaq sink on hot inflation, new Trump tariffs as chip rout continues',
      source: 'Yahoo Finance',
      content: '',
      relatedTickers: ['NVDA'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Nvidia faces questions from top Senate antitrust Democrat',
      source: 'Reuters / Yahoo Finance',
      content: '',
      relatedTickers: ['NVDA'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Oracle, CoreWeave Face Stark Warning From Credit Markets',
      source: 'GuruFocus.com / Yahoo Finance',
      content: 'A troubling financial signal is emerging beneath the AI boom.',
      relatedTickers: ['CRWV', 'ORCL', 'NVDA', '9984.T', 'GOOGN', 'SPCX'],
      expectedScore: 0,
      diagnosticCategory: 'RELATED',
      disagreementReason:
        'Diagnostic labeled RELATED because CoreWeave is Nvidia’s primary GPU cloud partner, but Nvidia/NVDA is absent from title/snippet, and tag-only relatedTickers is dropped.',
    },
    {
      title: 'Nvidia Chipmaker TSMC Sends $22.6 Billion AI Signal',
      source: 'GuruFocus.com / Yahoo Finance',
      content: 'Wedbush sees another sign that the AI spending boom remains intact.',
      relatedTickers: ['TSM', 'NVDA', 'AMD', 'AAPL', 'TSM'],
      expectedScore: 1,
      diagnosticCategory: 'RELATED',
    },
    {
      title:
        'Trump Just Floated Taking a Stake in Nvidia. An Intel-Style Deal Could Be Worth $380 Billion',
      source: '24/7 Wall St. / Yahoo Finance',
      content:
        'Nvidia is printing cash and has no need for a federal bailout, yet the president says "maybe I should do it." A government stake would put Washington on both sides of the chip export decisions that shape the company\'s profits.',
      relatedTickers: ['NVDA', 'INTC'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Why SpaceX Stock Keeps Going Down',
      source: 'Motley Fool / Yahoo Finance',
      content: 'SpaceX stock is now a broken IPO -- and Tesla may be to blame.',
      relatedTickers: ['SPCX', 'NVDA'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Without an Anthropic Rally, “There Will Be No OpenAI.” AMD Is the Real Loser',
      source: 'TIKR / Yahoo Finance',
      content:
        'Key Takeaways: Anthropic fell below its $83 IPO price on Tuesday, and AMD fell 9% on a filing registering up to 336. 9 million shares for resale.',
      relatedTickers: ['AMD', 'ANT', 'ORCL', 'AVGO', 'NVDA', 'META'],
      expectedScore: 0,
      diagnosticCategory: 'RELATED',
      disagreementReason:
        'Diagnostic labeled RELATED due to AMD AI chip competition, but Nvidia/NVDA is absent from title/snippet, and tag-only relatedTickers is dropped.',
    },
    {
      title:
        'This May Be the Best Artificial Intelligence (AI) Stock to Buy in December (Hint: It’s Not Micron or Oracle)',
      source: 'Motley Fool / Yahoo Finance',
      content:
        "Snowflake's shares have jumped nicely over the past six months, and they can get a shot in the arm following the upcoming earnings report.",
      relatedTickers: ['MU', 'ORCL', 'SNOW', 'SOXX', 'NVDA'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'Nvidia Just Delivered Its Latest Earnings Report. Is the Stock a Buy Below $160?',
      source: 'Motley Fool / Yahoo Finance',
      content:
        "Multiple factors are driving down Nvidia's share price. Investors need to decide whether they think the business is impaired in the long term.",
      relatedTickers: ['NVDA'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title:
        "Market Chatter: US Officials Tell Congress Nvidia CEO Huang's Affair Not Orchestrated by China",
      source: 'MT Newswires / Yahoo Finance',
      content: '',
      relatedTickers: ['NVDA'],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'What Tom Gardner Said About Days Like This',
      source: 'Motley Fool / Yahoo Finance',
      content: '"Emotional reactivity is the enemy of wealth creation," said The Motley Fool co-founder.',
      relatedTickers: ['NVDA'],
      expectedScore: 0,
      diagnosticCategory: 'UNRELATED',
    },
    {
      title: 'The Nvidia Rally Fizzles',
      source: 'New York Times Business',
      content:
        'Jensen Huang may be running Nvidia again, but investors are losing faith in the artificial intelligence boom the chipmaker has underpinned.',
      relatedTickers: [],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
    {
      title: 'Jensen Huang poses the question: what happens when a leader becomes too big to fail?',
      source: 'fastcompany',
      content:
        'Less than a week after Nvidia’s board said it would not reinstate Jensen Huang, it renamed him President and CEO. President Trump had intervened with public support for Huang and reportedly even called into a board meeting, urging directors to reconsider…',
      relatedTickers: [],
      expectedScore: 1,
      diagnosticCategory: 'DIRECT',
    },
  ],
};

describe('Balanced Filter for GRAPH PRICE News Relevance', () => {
  it('correctly scores all 48 diagnostic headlines according to the Balanced specification', () => {
    let totalHeadlines = 0;
    let totalKept = 0;
    let totalDropped = 0;

    const perTickerReport: Record<
      string,
      { total: number; kept: number; dropped: number; tier1: number; tier2: number; disagreements: number }
    > = {};

    for (const [ticker, items] of Object.entries(DIAGNOSTIC_FIXTURES)) {
      perTickerReport[ticker] = { total: items.length, kept: 0, dropped: 0, tier1: 0, tier2: 0, disagreements: 0 };

      items.forEach((item, idx) => {
        totalHeadlines++;
        const actualScore = scoreArticleForTicker(item, ticker);
        assert.strictEqual(
          actualScore,
          item.expectedScore,
          `Ticker ${ticker} headline #${idx + 1} "${item.title}" expected score ${item.expectedScore} but got ${actualScore}`
        );

        if (actualScore > 0) {
          totalKept++;
          perTickerReport[ticker].kept++;
          if (actualScore === 1) perTickerReport[ticker].tier1++;
          if (actualScore === 2) perTickerReport[ticker].tier2++;
        } else {
          totalDropped++;
          perTickerReport[ticker].dropped++;
        }

        const isDiagKept = item.diagnosticCategory === 'DIRECT' || item.diagnosticCategory === 'RELATED';
        const isRuleKept = actualScore > 0;
        if (isDiagKept !== isRuleKept) {
          perTickerReport[ticker].disagreements++;
          assert.ok(
            item.disagreementReason,
            `Missing documented reason for disagreement on ${ticker} item "${item.title}"`
          );
        }
      });
    }

    assert.strictEqual(totalHeadlines, 48);
    // AAPL: 6 kept (5 T1, 1 T2), 8 dropped
    assert.strictEqual(perTickerReport.AAPL.kept, 6);
    assert.strictEqual(perTickerReport.AAPL.dropped, 8);

    // GOOG: 3 kept (2 T1, 1 T2), 2 dropped
    assert.strictEqual(perTickerReport.GOOG.kept, 3);
    assert.strictEqual(perTickerReport.GOOG.dropped, 2);

    // MSFT: 4 kept (4 T1, 0 T2), 9 dropped
    assert.strictEqual(perTickerReport.MSFT.kept, 4);
    assert.strictEqual(perTickerReport.MSFT.dropped, 9);

    // NVDA: 9 kept (9 T1, 0 T2), 7 dropped
    assert.strictEqual(perTickerReport.NVDA.kept, 9);
    assert.strictEqual(perTickerReport.NVDA.dropped, 7);
  });

  it('handles synthetic edge cases: common-word tickers, short tickers, and ambiguous company names', () => {
    // 1. Short ticker (<= 2 chars e.g. "T" for AT&T or "C" for Citigroup)
    // Must NOT match bare lowercase or bare uppercase "t" or "c"
    assert.strictEqual(matchTickerExact('Today we look at technology', 'T'), false);
    assert.strictEqual(matchTickerExact('Today we look at C programming', 'C'), false);
    assert.strictEqual(matchTickerExact('Shares of $T rose 2%', 'T'), true);
    assert.strictEqual(matchTickerExact('AT&T (NYSE:T) declared dividend', 'T'), true);
    assert.strictEqual(matchTickerExact('Citigroup (C) reports earnings', 'C'), true);

    // 2. Common-word ticker (e.g. "ALL" for Allstate, "NOW" for ServiceNow, "ON" for ON Semiconductor)
    assert.strictEqual(matchTickerExact('Stocks decline across ALL sectors today', 'ALL'), false);
    assert.strictEqual(matchTickerExact('Buy stocks NOW for future growth', 'NOW'), false);
    assert.strictEqual(matchTickerExact('Allstate $ALL declares dividend', 'ALL'), true);
    assert.strictEqual(matchTickerExact('ServiceNow (NOW) beats consensus', 'NOW'), true);
    assert.strictEqual(matchTickerExact('ON Semiconductor (NASDAQ:ON) surges', 'ON'), true);

    // 3. Ambiguous company name normalization (Target, Block, Snap, Visa, Gap)
    assert.strictEqual(normalizeCompanyName('Target Corporation'), null);
    assert.strictEqual(normalizeCompanyName('Block, Inc.'), null);
    assert.strictEqual(normalizeCompanyName('Snap Inc.'), null);
    assert.strictEqual(normalizeCompanyName('Visa Inc.'), null);
    assert.strictEqual(normalizeCompanyName('The Gap, Inc.'), null);
    assert.strictEqual(normalizeCompanyName('Apple Inc.'), 'Apple');
    assert.strictEqual(normalizeCompanyName('Microsoft Corporation'), 'Microsoft');
    assert.strictEqual(normalizeCompanyName('NVIDIA Corp'), 'NVIDIA');

    // 4. Syndicated market report drop rule
    assert.strictEqual(
      isSyndicatedMarketReport('Global AI Market Report 2026: Trends to 2030', 'GlobeNewswire'),
      true
    );
    assert.strictEqual(
      isSyndicatedMarketReport('Digital Twins Market worth USD 101.19 Billion by 2031 at 68% CAGR', 'PR Newswire'),
      true
    );
    assert.strictEqual(
      isSyndicatedMarketReport('Microsoft Announces New AI Features for Office', 'PR Newswire'),
      false
    );

    // 5. Weak aliases (e.g. Elon Musk, Jeff Bezos, iPhone, Windows, Android) require ticker in relatedTickers
    const teslaNoTag: NewsItemLike = {
      title: 'Elon Musk comments on new rocket design',
      content: 'Starship flight 6 test prepares for launch.',
      relatedTickers: ['SPCX'],
    };
    assert.strictEqual(scoreArticleForTicker(teslaNoTag, 'TSLA'), 0); // Dropped because TSLA not in relatedTickers

    const teslaWithTag: NewsItemLike = {
      title: 'Elon Musk comments on robotaxi rollout timeline',
      content: 'The CEO gave updates on autonomous driving.',
      relatedTickers: ['TSLA'],
    };
    assert.strictEqual(scoreArticleForTicker(teslaWithTag, 'TSLA'), 2); // Tier 2 because weak alias + TSLA in relatedTickers

    // 6. Bare META case sensitivity
    assert.strictEqual(matchTokensWordBoundary('The meta-analysis of data', ['META']), false);
    assert.strictEqual(matchTokensWordBoundary('META PLATFORMS announced earnings', ['META PLATFORMS']), true);
  });

  it('correctly filters NEWS HUB articles when filtered by ticker (NEWS GOOG, NEWS AAPL, and invalid ticker)', () => {
    // Sample articles representing typical mixed multi-source pool in NEWS HUB
    const newsHubSampleFeed: NewsItemLike[] = [
      {
        title: 'Cathie Wood Just Bought $17 Million of Alphabet Across 2 ARK Funds',
        source: 'Yahoo Finance',
        relatedTickers: ['GOOG'],
        content: 'Key Takeaways: Cathie Wood’s ARK Invest bought 62,681 Alphabet (GOOG) shares across two of its ETFs',
      },
      {
        title: 'Alphabet Is Most Beat Down AI Company',
        source: '24/7 Wall St. / Yahoo Finance',
        relatedTickers: ['GOOGN', 'AAPL', 'GOOG', 'TSLA'],
        content: 'Search worries are old news for Alphabet. A shaky Apple deal, a rival chatbot gaining ground, and a massive data center bet...',
      },
      {
        title: 'Google Ends $75 Million News Deal Amid Regulatory Fight',
        source: 'GuruFocus.com / Yahoo Finance',
        relatedTickers: ['GOOGN', 'GOOG'],
        content: 'The decision could reshape how technology companies fund journalism.',
      },
      {
        title: '3 High-Growth Stocks That Could Make $10,000 Worth Much More by 2030',
        source: '24/7 Wall St. / Yahoo Finance',
        relatedTickers: ['MU', 'GOOGN', 'MELI', 'GOOG', 'SOFI'],
        content: "One chip maker's bull case dwarfs everything else here, yet its bear case barely beats breaking even. We ran $10,000 through Alphabet, Micron and MercadoLibre...",
      },
      {
        title: 'How Warren Buffett Makes Billions from Dividends: Top 10 Stocks',
        source: 'Insider Monkey / Yahoo Finance',
        relatedTickers: ['BRK-B', 'OXY', 'AAPL', 'CB', 'GOOG', 'KR'],
        content: 'Warren Buffett and dividends are an old love story that continues to this day, as Berkshire’s latest 13F filing shows...',
      },
      {
        title: 'Another Hot Inflation Reading Keeps Fed on Track to Raise Rates Again',
        source: 'New York Times Business',
        relatedTickers: [],
        content: 'The Federal Reserve is widely expected to raise interest rates next month.',
      },
      {
        title: 'Trump Administration Unveils New Tariffs for Dozens of Countries, Citing Unfair Practices',
        source: 'New York Times Business',
        relatedTickers: [],
        content: 'The latest escalation came as the administration confronts continued legal obstacles and new scrutiny.',
      },
      {
        title: 'The Nvidia Rally Fizzles',
        source: 'New York Times Business',
        relatedTickers: [],
        content: 'Jensen Huang may be running Nvidia again, but investors are losing faith in the artificial intelligence boom the chipmaker has underpinned.',
      },
      {
        title: 'Jensen Huang poses the question: what happens when a leader becomes too big to fail?',
        source: 'fastcompany',
        relatedTickers: [],
        content: 'Less than a week after Nvidia’s board said it would not reinstate Jensen Huang, it renamed him President and CEO...',
      },
      {
        title: 'Blanche Downplays Questions Over Nvidia as Investigators Examine Company’s Customers',
        source: 'New York Times Business',
        relatedTickers: [],
        content: 'Justice Department investigators have gathered evidence of Nvidia’s high-powered computer chips being diverted...',
      },
      {
        title: 'Damen and Windcat sign for second Multi-Purpose Accommodation Support Vessel (MP-ASV)',
        source: 'hellenicshippingnews',
        relatedTickers: [],
        content: 'On 24 November 2026, Windcat signed a contract with Damen Shipyards Group for the second vessel...',
      },
      {
        title: 'Ansarada Partners with Grata Intelligence to Accelerate Due Diligence and Deal Execution',
        source: 'prnewswire_apac',
        relatedTickers: [],
        content: 'Integration brings permissioned data room content into an agentic M&A workspace, connecting deal intelligence...',
      },
      {
        title: 'Apple Inc. Expands Services Segment with Record Q4 Revenue',
        source: 'Bloomberg',
        relatedTickers: ['AAPL'],
        content: 'Apple reported growth across App Store, iCloud, and Apple Music.',
      },
    ];

    // Case 1: NEWS GOOG (must keep Cathie Wood, Alphabet Beat Down, Google News Deal, 3 High-Growth Stocks)
    // (must drop Buffett, tariffs, inflation, the Nvidia stories, Damen/Windcat, Ansarada, Apple)
    const googKept = newsHubSampleFeed
      .map((item) => ({ item, score: scoreArticleForTicker(item, 'GOOG', 'Alphabet Inc.') }))
      .filter((entry) => entry.score > 0);

    const googTitles = googKept.map((e) => e.item.title);
    assert.strictEqual(googKept.length, 4);
    assert.ok(googTitles.includes('Cathie Wood Just Bought $17 Million of Alphabet Across 2 ARK Funds'));
    assert.ok(googTitles.includes('Alphabet Is Most Beat Down AI Company'));
    assert.ok(googTitles.includes('Google Ends $75 Million News Deal Amid Regulatory Fight'));
    assert.ok(googTitles.includes('3 High-Growth Stocks That Could Make $10,000 Worth Much More by 2030'));

    assert.ok(!googTitles.includes('How Warren Buffett Makes Billions from Dividends: Top 10 Stocks'));
    assert.ok(!googTitles.includes('Another Hot Inflation Reading Keeps Fed on Track to Raise Rates Again'));
    assert.ok(!googTitles.includes('Trump Administration Unveils New Tariffs for Dozens of Countries, Citing Unfair Practices'));
    assert.ok(!googTitles.includes('The Nvidia Rally Fizzles'));
    assert.ok(!googTitles.includes('Jensen Huang poses the question: what happens when a leader becomes too big to fail?'));
    assert.ok(!googTitles.includes('Blanche Downplays Questions Over Nvidia as Investigators Examine Company’s Customers'));
    assert.ok(!googTitles.includes('Damen and Windcat sign for second Multi-Purpose Accommodation Support Vessel (MP-ASV)'));
    assert.ok(!googTitles.includes('Ansarada Partners with Grata Intelligence to Accelerate Due Diligence and Deal Execution'));

    // Case 2: NEWS AAPL (keeps Apple story and Alphabet Beat Down which discusses Apple deal in content)
    const aaplKept = newsHubSampleFeed
      .map((item) => ({ item, score: scoreArticleForTicker(item, 'AAPL', 'Apple Inc.') }))
      .filter((entry) => entry.score > 0);
    const aaplTitles = aaplKept.map((e) => e.item.title);
    assert.ok(aaplTitles.includes('Apple Inc. Expands Services Segment with Record Q4 Revenue'));
    assert.ok(aaplTitles.includes('Alphabet Is Most Beat Down AI Company')); // Mentions Apple deal in content

    // Case 3: Invalid ticker NEWS APPL (must return 0 items)
    const applKept = newsHubSampleFeed
      .map((item) => ({ item, score: scoreArticleForTicker(item, 'APPL') }))
      .filter((entry) => entry.score > 0);
    assert.strictEqual(applKept.length, 0);
  });
});
