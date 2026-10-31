import assert from'node:assert/strict';import{test}from'node:test';import{reportPeriod,previousReportPeriod}from'../lib/reporting.ts';
test('weekly reports use Monday to Sunday across year boundaries',()=>{assert.deepEqual(reportPeriod('2027-01-01',undefined,'weekly'),{start:'2026-12-28',end:'2027-01-03'});assert.deepEqual(previousReportPeriod('2026-12-28','2027-01-03'),{start:'2026-12-21',end:'2026-12-27'});});
test('monthly comparison respects calendar length and leap days',()=>{assert.deepEqual(reportPeriod('2028-02-15',undefined,'monthly'),{start:'2028-02-01',end:'2028-02-29'});assert.deepEqual(previousReportPeriod('2028-03-01','2028-03-31'),{start:'2028-02-01',end:'2028-02-29'});assert.deepEqual(previousReportPeriod('2027-01-01','2027-01-31'),{start:'2026-12-01',end:'2026-12-31'});});
test('custom report intervals preserve exact selected boundaries',()=>{assert.deepEqual(reportPeriod('2026-10-20','2026-10-24','custom'),{start:'2026-10-20',end:'2026-10-24'});assert.deepEqual(previousReportPeriod('2026-10-20','2026-10-24'),{start:'2026-10-15',end:'2026-10-19'});});

test('multi-month and year comparisons never overlap their selected ranges',()=>{
  for(const [start,end] of [['2026-07-01','2026-09-30'],['2026-08-01','2026-09-30'],['2026-01-01','2026-12-31']]){
    const previous=previousReportPeriod(start,end);
    assert.ok(previous.end<start);
    assert.equal(Date.parse(previous.end)-Date.parse(previous.start),Date.parse(end)-Date.parse(start));
  }
});
test('standard report cycles override retained custom dates',()=>{
  assert.deepEqual(reportPeriod('2026-10-27','2026-10-28','weekly'),{start:'2026-10-26',end:'2026-11-01'});
  assert.deepEqual(reportPeriod('2026-10-27','2026-10-28','monthly'),{start:'2026-10-01',end:'2026-10-31'});
  assert.deepEqual(reportPeriod('2026-10-27','2026-10-28','daily'),{start:'2026-10-27',end:'2026-10-27'});
});
test('invalid, reversed and overlong custom periods are rejected explicitly',()=>{
  assert.throws(()=>reportPeriod('2026-02-30',undefined,'daily'),/valid reference/);
  assert.throws(()=>reportPeriod('2026-10-31','2026-10-01','custom'),/on or after/);
  assert.throws(()=>reportPeriod('2025-01-01','2026-10-31','custom'),/367 days/);
  assert.throws(()=>reportPeriod('2026-10-31',undefined,'custom'),/valid end/);
});
