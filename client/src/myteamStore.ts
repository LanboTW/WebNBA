import { emptyCustom, newMyTeam, upgradeCustom, upgradeMyTeam, type CustomSave, type MyTeamSave } from '@webnba/shared';
import { AccountDoc } from './accountDoc';

/** The account's MyTeam collection (data.myteam; the starter cards on first use). */
export const myteam = new AccountDoc<MyTeamSave>({ field: 'myteam', upgrade: upgradeMyTeam, create: () => newMyTeam() });

/** The account's custom players, custom teams and retired career players (data.custom). */
export const custom = new AccountDoc<CustomSave>({ field: 'custom', upgrade: upgradeCustom, create: emptyCustom });
