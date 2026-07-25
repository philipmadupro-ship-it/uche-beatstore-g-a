export function canAccessDesignSystemLab(env = process.env.NODE_ENV) {
  return env !== 'production';
}
