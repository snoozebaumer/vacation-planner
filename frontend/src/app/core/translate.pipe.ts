import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

// Impure so it re-evaluates on every change-detection run — the dictionary
// lookup itself is cheap, and this guarantees translated text updates the
// moment the language signal changes, regardless of what triggered CD.
@Pipe({ name: 'translate', pure: false })
export class TranslatePipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
