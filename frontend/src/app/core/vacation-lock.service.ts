import { Injectable } from '@angular/core';

const KEY_PREFIX = 'vacationplanner-unlock-';

// Tokens live in sessionStorage specifically — cleared when the browser tab
// closes, which is exactly "only ask once per session". The backend also
// time-limits the token itself as a backstop (see vacationAuth.ts), but the
// session boundary that actually matters to the user is enforced here.
@Injectable({ providedIn: 'root' })
export class VacationLockService {
  getToken(vacationId: string): string | null {
    try {
      return sessionStorage.getItem(KEY_PREFIX + vacationId);
    } catch {
      return null;
    }
  }

  setToken(vacationId: string, token: string): void {
    try {
      sessionStorage.setItem(KEY_PREFIX + vacationId, token);
    } catch {
      // Private browsing / storage disabled — nothing to do; the user will
      // just be asked for the password again on the next request.
    }
  }

  hasToken(vacationId: string): boolean {
    return this.getToken(vacationId) !== null;
  }
}
