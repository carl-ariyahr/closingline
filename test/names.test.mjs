import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyTeam, sameTeam, normName } from '../lib/names.mjs';

test('college shorthand: VSiN board names resolve to ESPN location/display names', () => {
  const cases = [
    ['N Illinois Huskies', 'Northern Illinois', 'Northern Illinois Huskies', true],
    ['N Illinois Huskies', 'Illinois', 'Illinois Fighting Illini', false],
    ['W Georgia', 'West Georgia', 'West Georgia Wolves', true],
    ['W Georgia', 'Georgia', 'Georgia Bulldogs', false],
    ['LIU-Post', 'Long Island University', 'Long Island University Sharks', true],
    ['Albany', 'UAlbany', 'UAlbany Great Danes', true],
    ['Connecticut Huskies', 'UConn', 'UConn Huskies', true],
    ['Appalachian ST Mountaineers', 'App State', 'App State Mountaineers', true],
    ['Miss Valley ST', 'Mississippi Valley State', 'Mississippi Valley State Delta Devils', true],
    ['Ark-Pine Bluff', 'Arkansas-Pine Bluff', 'Arkansas-Pine Bluff Golden Lions', true],
    ['Iowa Hawkies', 'Iowa', 'Iowa Hawkeyes', true],          // VSiN typo
    ['Iowa Hawkies', 'Iowa State', 'Iowa State Cyclones', false],
    ['Iowa ST Cyclones', 'Iowa', 'Iowa Hawkeyes', false],
    ['Iowa ST Cyclones', 'Iowa State', 'Iowa State Cyclones', true],
    ['Army Black Nights', 'Army', 'Army Black Knights', true],  // VSiN typo
    ['Texas-San Antonio Roadrunners', 'UTSA', 'UTSA Roadrunners', true],
    ['S Alabama Jaguars', 'South Alabama', 'South Alabama Jaguars', true],
    ['S Alabama Jaguars', 'Alabama', 'Alabama Crimson Tide', false],
    ['Murray ST', 'Murray State', 'Murray State Racers', true],
    ['UTRGV', 'UT Rio Grande Valley', 'UT Rio Grande Valley Vaqueros', true],
  ];
  for (const [v, loc, name, want] of cases) assert.equal(fuzzyTeam(v, loc, name), want, `${v} vs ${name}`);
});

test('sameTeam: exact/prefix with ST -> State; never last-word only', () => {
  assert.equal(sameTeam('Kansas ST', 'Kansas State Wildcats'), true);
  assert.equal(sameTeam('Boston Red Sox', 'Chicago White Sox'), false);
  assert.equal(normName('ST Louis Cardinals'), 'statelouiscardinals');
});
