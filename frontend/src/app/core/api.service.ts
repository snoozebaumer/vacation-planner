import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  Bucket,
  BucketWeight,
  MatchupResponse,
  MyMapsExportResponse,
  RankingResponse,
  Vacation,
  VacationUser,
} from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly base = '/api';

  constructor(private http: HttpClient) {}

  listVacations(): Observable<Vacation[]> {
    return this.http.get<Vacation[]>(`${this.base}/vacations`);
  }

  getVacation(vacationId: string): Observable<Vacation> {
    return this.http.get<Vacation>(`${this.base}/vacations/${vacationId}`);
  }

  createVacation(form: FormData): Observable<Vacation> {
    return this.http.post<Vacation>(`${this.base}/vacations`, form);
  }

  getVacationPhotoUrls(vacationId: string): Observable<{ photoUrls: string[] }> {
    return this.http.get<{ photoUrls: string[] }>(`${this.base}/vacations/${vacationId}/photos`);
  }

  unlockVacation(vacationId: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.base}/vacations/${vacationId}/unlock`, { password });
  }

  deleteVacation(vacationId: string, password?: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.base}/vacations/${vacationId}`, {
      body: password ? { password } : {},
    });
  }

  listUsers(vacationId: string): Observable<VacationUser[]> {
    return this.http.get<VacationUser[]>(`${this.base}/vacations/${vacationId}/users`);
  }

  createUser(vacationId: string, name: string): Observable<VacationUser> {
    return this.http.post<VacationUser>(`${this.base}/vacations/${vacationId}/users`, { name });
  }

  getMatchup(vacationId: string, userId: string): Observable<MatchupResponse> {
    return this.http.get<MatchupResponse>(`${this.base}/vacations/${vacationId}/users/${userId}/matchup`);
  }

  vote(
    vacationId: string,
    userId: string,
    winnerId: string,
    loserId: string
  ): Observable<{ winnerElo: number; loserElo: number; roundCompleted: boolean }> {
    return this.http.post<{ winnerElo: number; loserElo: number; roundCompleted: boolean }>(
      `${this.base}/vacations/${vacationId}/users/${userId}/vote`,
      { winnerId, loserId }
    );
  }

  getRanking(vacationId: string, userId?: string | null): Observable<RankingResponse> {
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    return this.http.get<RankingResponse>(`${this.base}/vacations/${vacationId}/ranking${query}`);
  }

  exportMyMaps(vacationId: string, lang: string): Observable<MyMapsExportResponse> {
    return this.http.get<MyMapsExportResponse>(
      `${this.base}/vacations/${vacationId}/export/mymaps?lang=${encodeURIComponent(lang)}`
    );
  }

  setVeto(vacationId: string, userId: string, placeId: string): Observable<{ placeId: string }> {
    return this.http.put<{ placeId: string }>(
      `${this.base}/vacations/${vacationId}/users/${userId}/veto`,
      { placeId }
    );
  }

  clearVeto(vacationId: string, userId: string): Observable<{ placeId: null }> {
    return this.http.delete<{ placeId: null }>(`${this.base}/vacations/${vacationId}/users/${userId}/veto`);
  }

  getBuckets(vacationId: string): Observable<{ buckets: Bucket[]; uncategorizedCount: number }> {
    return this.http.get<{ buckets: Bucket[]; uncategorizedCount: number }>(`${this.base}/vacations/${vacationId}/buckets`);
  }

  getBucketWeights(vacationId: string, userId: string): Observable<{ weights: BucketWeight[] }> {
    return this.http.get<{ weights: BucketWeight[] }>(
      `${this.base}/vacations/${vacationId}/users/${userId}/weights`
    );
  }

  setBucketWeights(vacationId: string, userId: string, weights: BucketWeight[]): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(
      `${this.base}/vacations/${vacationId}/users/${userId}/weights`,
      { weights }
    );
  }

  retryUncategorized(vacationId: string): Observable<{ retried: number }> {
    return this.http.post<{ retried: number }>(`${this.base}/vacations/${vacationId}/buckets/retry-uncategorized`, {});
  }

  suggestPlaces(title: string): Observable<{ suggestions: string[] }> {
    return this.http.post<{ suggestions: string[] }>(`${this.base}/place-suggestions`, { title });
  }
}
