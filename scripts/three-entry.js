// Entry for the tree-shaken Three.js bundle used by /weigh (see scripts/build-three.sh). Add exports here if a model needs more.
export {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Object3D, Vector3, Color, MathUtils, Box3, Sphere, Clock,
  MeshStandardMaterial, MeshLambertMaterial, MeshBasicMaterial, DoubleSide, FrontSide,
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, CapsuleGeometry, PlaneGeometry, CircleGeometry, RingGeometry,
  TubeGeometry, LatheGeometry, CatmullRomCurve3, Vector2,
  HemisphereLight, DirectionalLight, AmbientLight, SRGBColorSpace, ACESFilmicToneMapping, NoToneMapping,
} from 'three';
