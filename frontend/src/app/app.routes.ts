import { Routes } from '@angular/router';
import { VacationSelectComponent } from './features/vacation-select/vacation-select.component';
import { VacationCreateComponent } from './features/vacation-create/vacation-create.component';
import { UserSelectComponent } from './features/user-select/user-select.component';
import { BucketWeightsComponent } from './features/bucket-weights/bucket-weights.component';
import { MatchupComponent } from './features/matchup/matchup.component';
import { RankingComponent } from './features/ranking/ranking.component';
import { VacationUnlockComponent } from './features/vacation-unlock/vacation-unlock.component';
import { VacationPlacesComponent } from './features/vacation-places/vacation-places.component';

export const routes: Routes = [
  { path: '', component: VacationSelectComponent },
  { path: 'vacations/new', component: VacationCreateComponent },
  // A bare vacation link (what gets shared with friends, see user-select's
  // share box) has nothing of its own to show — send it straight to user
  // selection, which is itself already gated behind the unlock screen for
  // a password-protected vacation via the vacation-lock interceptor.
  { path: 'vacations/:vacationId', pathMatch: 'full', redirectTo: 'vacations/:vacationId/users' },
  { path: 'vacations/:vacationId/unlock', component: VacationUnlockComponent },
  { path: 'vacations/:vacationId/users', component: UserSelectComponent },
  { path: 'vacations/:vacationId/users/:userId/places', component: VacationPlacesComponent },
  { path: 'vacations/:vacationId/users/:userId/priorities', component: BucketWeightsComponent },
  { path: 'vacations/:vacationId/users/:userId/play', component: MatchupComponent },
  { path: 'vacations/:vacationId/ranking', component: RankingComponent },
  { path: '**', redirectTo: '' },
];
