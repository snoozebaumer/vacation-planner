import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { ApiService } from '../../core/api.service';
import { I18nService } from '../../core/i18n.service';
import { TranslatePipe } from '../../core/translate.pipe';
import { VacationLockService } from '../../core/vacation-lock.service';

// Just the shell now (name + duration) — places and the active-hours/
// travel-time pacing preferences move to the collaborative places screen
// (features/vacation-places), so this can submit instantly and hand off to
// user-select with nothing left to poll for.
@Component({
  selector: 'app-vacation-create',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, MatCheckboxModule, TranslatePipe],
  templateUrl: './vacation-create.component.html',
  styleUrl: './vacation-create.component.scss',
})
export class VacationCreateComponent {
  // Plain (non-signal) fields: only ever mutated from DOM event bindings
  // (ngModel), which already schedule change detection on their own in
  // zoneless Angular.
  name = '';
  durationDays: number | null = null;
  isPrivate = false;
  password = '';

  submitting = signal(false);
  errorMessage = signal('');

  constructor(
    private api: ApiService,
    private router: Router,
    private lock: VacationLockService,
    readonly i18n: I18nService
  ) {}

  get canSubmit(): boolean {
    return (
      this.name.trim().length > 2 &&
      this.name.trim().length <= 100 &&
      !!this.durationDays &&
      this.durationDays > 0 &&
      (!this.isPrivate || this.password.trim().length > 0) &&
      !this.submitting()
    );
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.errorMessage.set('');
    this.submitting.set(true);

    const password = this.isPrivate ? this.password.trim() : undefined;

    this.api.createVacation(this.name.trim(), this.durationDays!, password).subscribe({
      next: (vacation) => {
        // The creator just typed this password in — unlocking them
        // immediately means they aren't asked to re-enter it a moment
        // later on the very next screen.
        if (password) {
          this.api.unlockVacation(vacation.id, password).subscribe({
            next: ({ token }) => this.lock.setToken(vacation.id, token),
            error: () => {}, // non-fatal — they'll just be asked once, same as anyone else
          });
        }
        this.router.navigate(['/vacations', vacation.id, 'users']);
      },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err?.error?.error ?? this.i18n.t('vacationCreate.createError'));
      },
    });
  }
}
