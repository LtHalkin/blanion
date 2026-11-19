// Entry for the tree-shaken Three.js bundle used by /weigh and /golf (see scripts/build-three.sh). Add exports here if a scene needs more.
export {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, Object3D, Vector3, Vector2, Color, MathUtils, Box3, Sphere, Clock, Raycaster, Plane, Quaternion, Euler, Matrix4,
  MeshStandardMaterial, MeshLambertMaterial, MeshBasicMaterial, MeshPhysicalMaterial, DoubleSide, FrontSide, BackSide,
  BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry, TorusGeometry, CapsuleGeometry, PlaneGeometry, CircleGeometry, RingGeometry,
  TubeGeometry, LatheGeometry, CatmullRomCurve3, IcosahedronGeometry, DodecahedronGeometry, OctahedronGeometry,
  Shape, Path, ShapeGeometry, ExtrudeGeometry, BufferGeometry, BufferAttribute, Float32BufferAttribute,
  CanvasTexture, Texture, RepeatWrapping, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, NearestFilter,
  Sprite, SpriteMaterial, Points, PointsMaterial, Line, LineSegments, LineBasicMaterial, AdditiveBlending, NormalBlending,
  HemisphereLight, DirectionalLight, AmbientLight, Fog, SRGBColorSpace, ACESFilmicToneMapping, NoToneMapping, PCFSoftShadowMap, PCFShadowMap,
} from 'three';
