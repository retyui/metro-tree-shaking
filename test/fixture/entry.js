import { get } from 'lodash-es';
import { add } from './math';

global.__result = {
  add: add(2, 3),
  get: get({ a: { b: { c: 'it works' } } }, 'a.b.c', 'default'),
};
