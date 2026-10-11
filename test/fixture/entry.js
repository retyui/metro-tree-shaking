import { get } from 'lodash-es';
import { greet } from './barrel';
import { add } from './math';

if (process.env.NODE_ENV !== 'production') {
  console.log('DEV_ONLY_MARKER');
}

global.__result = {
  add: add(2, 3),
  get: get({ a: { b: { c: 'it works' } } }, 'a.b.c', 'default'),
  greet: greet('cjs'),
};
