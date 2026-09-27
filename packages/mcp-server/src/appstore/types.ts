// App Store Connect JSON:API 응답 모양 — 이 코드가 실제로 읽는 필드만 선언한다.
//
// 응답을 런타임에 검증하지는 않는다 (apiGet 은 res.json() 을 그대로 돌려준다). 여기 타입은
// "이 모듈은 이 필드들을 이 모양으로 기대한다"는 선언이라, 모든 속성을 optional 로 두고
// 접근부는 `?.` / `??` 로 누락을 견딘다. 새 필드를 읽으려면 먼저 여기(또는 호출부의
// attributes 타입)에 적는다.

/** 관계의 한쪽 끝 — `{ type, id }` */
export interface AscRef {
  type: string;
  id: string;
}

/** to-one 관계 (`relationships.app.data`) */
export interface AscToOne {
  data?: AscRef | null;
}

/** to-many 관계 (`relationships.appScreenshots.data`) */
export interface AscToMany {
  data?: AscRef[];
}

type AnyRelationships = Record<string, AscToOne | AscToMany | undefined>;

/** JSON:API 리소스 객체. A = attributes, R = relationships. */
export interface AscResource<A = Record<string, unknown>, R = AnyRelationships> {
  id: string;
  type?: string;
  attributes?: A;
  relationships?: R;
}

/** 목록 응답 (`data[]` + 선택적 `included[]`). I = included 항목 모양. */
export interface AscListDocument<A = Record<string, unknown>, R = AnyRelationships, I = AscResource> {
  data?: AscResource<A, R>[];
  included?: I[];
  links?: { next?: string };
}

/** 단건 응답 (`data`). I = included 항목 모양. */
export interface AscSingleDocument<A = Record<string, unknown>, R = AnyRelationships, I = AscResource> {
  data?: AscResource<A, R>;
  included?: I[];
}
