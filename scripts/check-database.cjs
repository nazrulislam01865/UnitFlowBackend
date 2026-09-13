// Read-only production diagnostic. Run after npm run build using backend-owned credentials.
require('reflect-metadata');
const {Environment} = require('../dist/config/environment');
const {FirebaseService} = require('../dist/firebase/firebase.service');
(async () => {
  const firebase = new FirebaseService(new Environment());
  let failures = 0;
  try {
    const houses = await firebase.db.collection('houses').limit(5).get();
    if (houses.empty) console.log('No houses yet. Create a house, unit and resident before taking readings.');
    for (const house of houses.docs) {
      const units = house.ref.collection('units');
      const checks = [
        ['pending readings',units.where('occupied','==',true).where('lastCycle','<','9999-12').orderBy('lastCycle').orderBy('__name__').limit(1)],
        ['unit bills',house.ref.collection('bills').where('unitId','==','index-check').orderBy('cycle','desc').orderBy('__name__','desc').limit(1)],
        ['resident bills',house.ref.collection('bills').where('residentUid','==','index-check').orderBy('cycle','desc').orderBy('__name__','desc').limit(1)],
        ['resident activity',house.ref.collection('activities').where('subjectUid','==','index-check').orderBy('at','desc').orderBy('__name__','desc').limit(1)],
        ['member search',house.ref.collection('members').where('active','==',true).where('searchTokens','array-contains','index-check').orderBy('__name__').limit(1)],
      ];
      for (const [label,query] of checks) {
        try { await query.get(); console.log(`OK ${house.id}: ${label}`); }
        catch(error) {
          failures++;
          console.error(`FAILED ${house.id}: ${label}; provider code ${error.code ?? 'unknown'}`);
          const url=String(error.message).match(/https:\/\/console\.firebase\.google\.com\/[^\s]+/);
          if(url) console.error(url[0]);
        }
      }
      const sample=await units.limit(50).get();
      for(const unit of sample.docs) {
        const data=unit.data();
        if(typeof data.occupied!=='boolean' || typeof data.lastCycle!=='string' ||
           typeof data.lastDate!=='string' || !Number.isSafeInteger(data.revision)) {
          failures++;
          console.error(`Unit ${house.id}/${unit.id} has incomplete reading fields. Review its history before repairing data.`);
        }
      }
    }
    console.log('Read-only check complete (up to 5 houses and 50 units per house). No data was changed.');
  } finally { await firebase.onModuleDestroy(); }
  if(failures) process.exitCode=1;
})().catch(error=>{
  console.error(`Database check could not finish; provider code ${error.code ?? 'unknown'}. Check backend environment and permissions.`);
  process.exitCode=1;
});
