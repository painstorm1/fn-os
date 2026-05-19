# FN OS 배포 메모

## FN OS Vercel 환경변수

FN OS 프로젝트에 아래 환경변수를 설정한다.

```env
FN_OS_PASSWORD=로그인에 사용할 비밀번호
FN_OS_AUTH_TOKEN=긴_랜덤_문자열
NEXT_PUBLIC_IMPORT_ERP_URL=https://기존-수입ERP-배포주소
```

`FN_OS_AUTH_TOKEN`은 로그인 쿠키 확인용 값이다. 비밀번호와 다른 긴 문자열을 권장한다.

## 수입ERP Vercel 환경변수

기존 수입ERP API가 새 FN OS 도메인의 요청을 허용해야 한다.

```env
FN_OS_ALLOWED_ORIGINS=https://새-FN-OS-배포주소
```

로컬 개발도 같이 쓸 경우:

```env
FN_OS_ALLOWED_ORIGINS=https://새-FN-OS-배포주소,http://localhost:3000,http://localhost:3001
```

## 배포 흐름

1. FN OS를 새 GitHub 저장소로 push한다.
2. Vercel에서 FN OS 저장소를 새 프로젝트로 import한다.
3. FN OS 환경변수를 설정한다.
4. 배포 후 생성된 FN OS 주소를 수입ERP의 `FN_OS_ALLOWED_ORIGINS`에 추가한다.
5. 수입ERP도 재배포한다.
