import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { VacationLockService } from './vacation-lock.service';

const VACATION_ID_PATTERN = /\/api\/vacations\/([0-9a-f-]{36})(?:\/|$|\?)/i;

// Two jobs: attach the stored unlock token to any request scoped to a
// vacation, and — regardless of which component made the request — bounce
// to the unlock screen the moment the backend says a vacation is locked.
// This is what makes "can't skip the password via a direct URL" actually
// hold: every page's first data call goes through here, so there's no
// entry point that doesn't get caught.
export const vacationLockInterceptor: HttpInterceptorFn = (req, next) => {
  const lockService = inject(VacationLockService);
  const router = inject(Router);

  const match = req.url.match(VACATION_ID_PATTERN);
  const vacationId = match ? match[1] : null;

  let outgoing = req;
  if (vacationId) {
    const token = lockService.getToken(vacationId);
    if (token) {
      outgoing = req.clone({ setHeaders: { 'X-Vacation-Unlock': token } });
    }
  }

  return next(outgoing).pipe(
    catchError((err) => {
      if (vacationId && err?.status === 401 && err?.error?.locked === true) {
        router.navigate(['/vacations', vacationId, 'unlock'], {
          queryParams: { returnUrl: router.url },
        });
      }
      return throwError(() => err);
    })
  );
};
