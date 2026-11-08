/** Pure appearance aggregation. Ratios are fractions; no measured data is null. */
function appearanceAggregate_(videos,members,filter) {
  const from=filter.from?appearanceDate_(filter.from,false):'',to=filter.to?appearanceDate_(filter.to,false):'';
  if(from&&to&&from>to)throw new Error('期間の開始日は終了日以前にしてください。');
  const selected=videos.filter(function(v){return (!from&&!to)||!!v.publishedAt&&(!from||v.publishedAt>=from)&&(!to||v.publishedAt<=to);});
  const rows=selected.map(function(v){
    const individual={};members.forEach(function(m){individual[m.memberId]=0;});
    const pairs={};let measuredMs=0,allMs=0;
    v.segments.forEach(function(s){
      const ms=s.endMs-s.startMs;measuredMs+=ms;
      if(s.memberIds==='NONE')return;
      const ids=s.memberIds.split(',');ids.forEach(function(id){individual[id]+=ms;});
      if(ids.length===6){allMs+=ms;return;}
      ids.forEach(function(a,i){ids.slice(i+1).forEach(function(b){const key=a+','+b;pairs[key]=(pairs[key]||0)+ms;});});
    });
    return {videoId:v.videoId,title:v.title,publishedAt:v.publishedAt,youtubeVideoId:v.youtubeVideoId,status:v.status,durationMs:v.durationMs,
      measuredMs:measuredMs,coverage:v.durationMs&&measuredMs?measuredMs/v.durationMs:null,provisional:measuredMs>0&&(!v.durationMs||measuredMs<v.durationMs),individual:individual,allMs:allMs,pairs:pairs};
  });
  const measured=rows.filter(function(v){return v.measuredMs>0;}),total=measured.reduce(function(n,v){return n+v.measuredMs;},0);
  const sum=function(key){return measured.reduce(function(n,v){return n+v[key];},0);};
  const rank=members.map(function(m){
    const ms=measured.reduce(function(n,v){return n+v.individual[m.memberId];},0);
    return {memberId:m.memberId,name:m.name,color:m.color,appearanceMs:ms,rate:total?ms/total:null,meanRate:measured.length?measured.reduce(function(n,v){return n+v.individual[m.memberId]/v.measuredMs;},0)/measured.length:null};
  }).sort(function(a,b){return b.appearanceMs-a.appearanceMs||a.memberId.localeCompare(b.memberId);});
  const pairRows=[];
  members.forEach(function(a,i){members.slice(i+1).forEach(function(b){const key=[a.memberId,b.memberId].sort().join(','),ms=measured.reduce(function(n,v){return n+(v.pairs[key]||0);},0);pairRows.push({memberIds:key,name:a.name+' × '+b.name,appearanceMs:ms,rate:total?ms/total:null});});});
  pairRows.sort(function(a,b){return b.appearanceMs-a.appearanceMs||a.memberIds.localeCompare(b.memberIds);});
  const dated=measured.filter(function(v){return !!v.publishedAt;}),months=[];
  const first=from?from.slice(0,7):dated.map(function(v){return v.publishedAt.slice(0,7);}).sort()[0];
  const last=to?to.slice(0,7):dated.map(function(v){return v.publishedAt.slice(0,7);}).sort().pop();
  if(first&&last){
    let cursor=first;
    // Gregorian dates are validated; a generous bound prevents accidental enormous payloads.
    if(Number(last.slice(0,4))-Number(first.slice(0,4))>150)throw new Error('集計期間は150年以内で指定してください。');
    while(cursor<=last){
      const list=dated.filter(function(v){return v.publishedAt.slice(0,7)===cursor;}),denominator=list.reduce(function(n,v){return n+v.measuredMs;},0),rates={};
      members.forEach(function(m){rates[m.memberId]=denominator?list.reduce(function(n,v){return n+v.individual[m.memberId];},0)/denominator:null;});
      months.push({month:cursor,measuredMs:denominator,rates:rates,provisional:list.some(function(v){return v.provisional;})});
      const year=Number(cursor.slice(0,4)),month=Number(cursor.slice(5));cursor=month===12?(year+1)+'-01':year+'-'+String(month+1).padStart(2,'0');
    }
  }
  const unknownDuration=measured.some(function(v){return !v.durationMs;}),duration=measured.reduce(function(n,v){return n+(v.durationMs||0);},0);
  return {members:members,ranking:rank,pairs:pairRows,videos:rows,months:months,measuredMs:total,videoCount:measured.length,
    coverage:!total||unknownDuration?null:total/duration,coverageUnavailable:unknownDuration,provisional:measured.some(function(v){return v.provisional;}),
    allMs:sum('allMs'),allRate:total?sum('allMs')/total:null,missingDateCount:selected.filter(function(v){return !v.publishedAt;}).length};
}
