-- Withdraw approval from series tags that break the tagging rules. The reasons are listed in
-- REVIEW-TAGS.md ("Incorrect mappings withdrawn"). Rows and their provenance are kept, so the
-- classifier does not propose them again; `npm run job -- approve-tag SERIES TAG` restores one.
UPDATE series_tags SET reviewed=false WHERE (series_ticker, tag) IN (
    -- Company tags: sponsorship, another company, a name collision, or a series covering many subjects.
    ('KXNASCARPOLE','BAC'), ('KXNASCARTOP20','BAC'), ('KXNASCARTOP5','BAC'), ('KXNASCARTOPTEAM','BAC'),
    ('KXSBUX','COST'), ('KXSBUXA','COST'),
    ('KXAAL','DAL'), ('KXAALA','DAL'), ('KXAALCC','DAL'), ('KXEARNINGSMENTIONAAL','DAL'),
    ('KXALK','DAL'), ('KXALKA','DAL'), ('KXEARNINGSMENTIONALK','DAL'),
    ('KXLUV','DAL'), ('KXLUVA','DAL'), ('KXLUVCC','DAL'),
    ('KXCHNL1SPREAD','DAL'), ('KXCHNL1TOTAL','DAL'), ('KXHIGHTDAL','DAL'), ('KXFLYCANCJFK','DAL'), ('KXORDPAX','DAL'),
    ('KXMOVIEDELAY','DIS'), ('KXEARNINGSMENTIONWFC','JPM'), ('KXMC','MSFT'), ('KXMAYOROFKINGSTOWN','NFLX'),
    ('KXTOKENUST','TLT'), ('KXUSTHOLDERS','TLT'),
    ('KXMUSKBLUESKY','TSLA'), ('KXMUSKCHALLENGERS','TSLA'), ('KXMUSKCHARGE','TSLA'), ('KXMUSKNW','TSLA'),
    ('KXMUSKPRIMARY','TSLA'), ('KXMUSKSPORTS','TSLA'), ('KXNEURALINKCOUNT','TSLA'),
    ('KXSCOTUSCASE','XOM'),
    -- fed-rates is measured against the US 2-year Treasury yield: other countries' central banks.
    ('KXBRRATECUT','fed-rates'), ('KXCANCUTS','fed-rates'), ('KXCANOREOY','fed-rates'),
    ('KXCBDCHILE','fed-rates'), ('KXCBDCOLOMBIA','fed-rates'), ('KXCBDCZECH','fed-rates'),
    ('KXCBDECISIONAUSTRALIA','fed-rates'), ('KXCBDECISIONBRAZIL','fed-rates'), ('KXCBDECISIONCANADA','fed-rates'),
    ('KXCBDECISIONENGLAND','fed-rates'), ('KXCBDECISIONEU','fed-rates'), ('KXCBDECISIONINDIA','fed-rates'),
    ('KXCBDECISIONJAPAN','fed-rates'), ('KXCBDECISIONKOREA','fed-rates'), ('KXCBDECISIONMEXICO','fed-rates'),
    ('KXCBDECISIONNZ','fed-rates'), ('KXCBDECISIONRUSSIA','fed-rates'), ('KXCBDHUNGARY','fed-rates'),
    ('KXCBDINDONESIA','fed-rates'), ('KXCBDISRAEL','fed-rates'), ('KXCBDNORWAY','fed-rates'),
    ('KXCBDPHILIPPINES','fed-rates'), ('KXCBDPOLAND','fed-rates'), ('KXCBDSA','fed-rates'),
    ('KXCBDSWEDEN','fed-rates'), ('KXCBDSWISS','fed-rates'), ('KXCBDTAIWAN','fed-rates'),
    ('KXCBDTHAILAND','fed-rates'), ('KXCBDTURKEY','fed-rates'), ('KXNEXTECBPRES','fed-rates'),
    -- fed-rates: people and politics, not the policy rate.
    ('KXDJTATTACKWARSH','fed-rates'), ('KXFEDEND','fed-rates'), ('KXFEDFREQ','fed-rates'), ('KXFEDGOVNOM','fed-rates'),
    ('KXFEDMENTION','fed-rates'), ('KXFEDREFORM','fed-rates'), ('KXLEAVELISACOOK','fed-rates'),
    ('KXLEAVEPOWELLGOV','fed-rates'), ('KXNEXTATLFED','fed-rates'), ('KXSUEPOWELL','fed-rates'),
    ('KXTRUMPVISITFED','fed-rates'), ('KXTRYFIRECOOK','fed-rates'), ('KXTRYFIREPOWELL','fed-rates'),
    ('KXTRYFIREWARSH','fed-rates'), ('KXWARSHOUT','fed-rates'),
    -- inflation: other countries' inflation, and money supply.
    ('KXARMOMINF','inflation'), ('KXBRAZILINF','inflation'), ('KXBRINFHIGH','inflation'), ('KXCANEUINFL','inflation'),
    ('KXCOWAGE','inflation'), ('KXJPSGINFL','inflation'), ('KXSAMOMINF','inflation'), ('KXUKEAINFL','inflation'),
    ('KXM2GROWTH','inflation'),
    -- oil is measured against crude futures: natural gas, ethanol, a gas pipeline, the 2030 energy mix.
    ('KXNATGAS15M','oil'), ('KXNATGASMON','oil'), ('KXNATGASW','oil'), ('KXNGASMAX','oil'), ('KXNGASMIN','oil'),
    ('KXMARCELLUSGAS','oil'), ('KXPAGAS','oil'), ('KXIAETHANOL','oil'), ('KXNORDSTREAM2','oil'),
    ('KXPRIMEENGCONSUMPTION','oil'),
    -- sp500 is measured against SPY: the Dow and Mexico's S&P/BMV IPC are other indexes.
    ('KXDJI','sp500'), ('KXDJIA','sp500'), ('KXDJIAREMOVE','sp500'), ('KXME','sp500')
);
