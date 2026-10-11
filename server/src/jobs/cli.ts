import { closePools, query } from '../db.ts';
import { poll } from './poll.ts';
import { prices } from './prices.ts';
import { measure } from './measure.ts';
import { backfill, historyMetadata } from './backfill.ts';
import { stockTags, tagSeries, reviewTags } from './tagging.ts';
import { summaries } from './summaries.ts';
import { briefings } from './briefing.ts';
import { riskFactors } from './risk.ts';
import { syncBrokerages } from '../brokerages/service.ts';
import { earningsDates } from './earnings-dates.ts';
import { scheduledJobNames } from './scheduler.ts';
const jobs: Record<string, () => Promise<void>> = { 'brokerages': syncBrokerages, poll, prices, measure, backfill, 'history-metadata': historyMetadata, 'stock-tags': stockTags, 'tag-series': tagSeries, 'review-tags': reviewTags, summaries, briefings, 'earnings-dates': earningsDates, 'sample-markets': async () => { console.table(await query(`SELECT m.ticker,m.title,s.yes_bid,s.yes_ask,s.mid,s.ts FROM markets m JOIN LATERAL(SELECT * FROM odds_snapshots WHERE ticker=m.ticker ORDER BY ts DESC LIMIT 1)s ON true LIMIT 3`)); }, 'sample-links': async () => { console.table(await query(`(SELECT * FROM measured_links WHERE reliable=true LIMIT 1) UNION ALL (SELECT * FROM measured_links WHERE reliable=false LIMIT 1)`)); }, 'approve-tag': async () => { const [series, tag] = process.argv.slice(3); if (!series || !tag)
        throw new Error('series ticker and tag required'); await query(`UPDATE series_tags SET reviewed=true WHERE series_ticker=$1 AND tag=$2`, [series, tag]); },
    // Withdraws approval but keeps the row, so the classifier does not propose the pair again.
    'reject-tag': async () => { const [series, tag] = process.argv.slice(3); if (!series || !tag)
        throw new Error('series ticker and tag required'); await query(`UPDATE series_tags SET reviewed=false WHERE series_ticker=$1 AND tag=$2`, [series, tag]); }, 'risk-factors': async () => { const [symbol, path, url] = process.argv.slice(3); if (!symbol || !path || !url)
        throw new Error('symbol filing-path source-url required'); await riskFactors(symbol, path, url); } };
try {
    if (process.argv[2] === 'resume-job') {
        const name = process.argv[3];
        if (!scheduledJobNames.some(value => value === name)) throw new Error(`Choose a scheduled job: ${scheduledJobNames.join(', ')}`);
        await query('DELETE FROM job_state WHERE name=$1', [`stopped-job:${name}`]);
        console.info('Stopped schedule acknowledged. Restart the backend to resume:', name);
    } else {
        const job = jobs[process.argv[2]];
        if (!job)
            throw new Error(`Choose a job: ${Object.keys(jobs).join(', ')}`);
        // Only an explicit CLI invocation acknowledges stopped per-item work.
        await query('DELETE FROM job_state WHERE name LIKE $1', [`stopped-task:${process.argv[2]}:%`]);
        if (process.argv[2] === 'tag-series') await query("UPDATE job_state SET cursor='' WHERE name LIKE 'tag-series:%' AND cursor LIKE 'failed:%'");
        await job();
        // A successful explicit run acknowledges the stopped job; restart the server
        // to resume its regular schedule after investigating the original failure.
        await query('DELETE FROM job_state WHERE name=$1', [`stopped-job:${process.argv[2]}`]);
    }
}
catch (error) {
    console.error(error instanceof Error && error.message.startsWith('Choose') ? error.message : 'Job failed; check configuration and source data');
    process.exitCode = 1;
}
finally {
    await closePools();
}
