'use client';

import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useState,
} from 'react';
import { customFetch, Params } from './custom.fetch.func';
import { useVariables } from '@gitroom/react/helpers/variable.context';

const FetchProvider = createContext(
  customFetch(
    // @ts-ignore
    {
      baseUrl: '',
      beforeRequest: () => {},
      afterRequest: () => {
        return true;
      },
    } as Params
  )
);

export const FetchWrapperComponent: FC<Params & { children: ReactNode }> = (
  props
) => {
  const { children, ...params } = props;
  const { isSecured } = useVariables();
  // Build once per mount; params/isSecured are expected to be stable across
  // renders for this provider. useState with an initializer avoids recreating
  // the fetch function and avoids reading a ref value during render.
  // @ts-ignore
  const [fetchData] = useState(() =>
    customFetch(params, undefined, undefined, isSecured)
  );
  return (
    // @ts-ignore
    <FetchProvider.Provider value={fetchData}>
      {children}
    </FetchProvider.Provider>
  );
};

export const useFetch = () => {
  return useContext(FetchProvider);
};
