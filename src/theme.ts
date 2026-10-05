import { alpha, createTheme } from '@mui/material/styles';

type ShadeRecord = {
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string;
  950?: string; main?: string; light?: string; dark?: string; contrastText?: string;
};

declare module '@mui/material/styles' {
  interface PaletteColor extends ShadeRecord {}
  interface SimplePaletteColorOptions extends Partial<ShadeRecord> {}
  interface Palette {
    primary: PaletteColor; secondary: PaletteColor; savannah: PaletteColor;
    terracotta: PaletteColor; saffron: PaletteColor; ink: PaletteColor;
    maasai: PaletteColor; shuka: PaletteColor; victoria: PaletteColor;
    acacia: PaletteColor; diani: PaletteColor;
  }
  interface PaletteOptions {
    savannah?: SimplePaletteColorOptions; terracotta?: SimplePaletteColorOptions;
    saffron?: SimplePaletteColorOptions; ink?: SimplePaletteColorOptions;
    maasai?: SimplePaletteColorOptions; shuka?: SimplePaletteColorOptions;
    victoria?: SimplePaletteColorOptions; acacia?: SimplePaletteColorOptions;
    diani?: SimplePaletteColorOptions;
  }
  interface TypeBackground { surface: string; surfaceVariant: string; canvas: string }
  interface Shape { pill: number; card: number; button: number; chip: number }
}

const black: ShadeRecord = { 50:'#f4f5f5',100:'#e5e7e7',200:'#cdd1d1',300:'#aab1b1',400:'#778181',500:'#526060',600:'#3c4747',700:'#293232',800:'#182020',900:'#0d1212',950:'#050808',main:'#101616',light:'#3c4747',dark:'#050808',contrastText:'#fff' };
const red: ShadeRecord = { 50:'#fff2f1',100:'#ffe1df',200:'#ffc4c1',300:'#ff9d98',400:'#f56f6a',500:'#c9433d',600:'#a52d29',700:'#83211e',800:'#641b19',900:'#3f1110',main:'#a52d29',light:'#c9433d',dark:'#641b19',contrastText:'#fff' };
const green: ShadeRecord = { 50:'#eff8f1',100:'#d9efdc',200:'#b5dfbc',300:'#87c991',400:'#54ad64',500:'#23843a',600:'#176b2b',700:'#105321',800:'#0a3d18',900:'#06270f',main:'#176b2b',light:'#23843a',dark:'#105321',contrastText:'#fff' };
const gold: ShadeRecord = { 50:'#fffaf0',100:'#fff0c9',200:'#ffe29a',300:'#ffd166',400:'#f4b942',500:'#c98b18',600:'#a66e0b',700:'#80520a',800:'#5f3e08',900:'#3d2805',main:'#c98b18',light:'#f4b942',dark:'#80520a',contrastText:'#16120a' };
const blue: ShadeRecord = { 50:'#eff7fb',100:'#d9edf5',200:'#b5dbe9',300:'#86c4d8',400:'#4ea6c1',500:'#1d7794',600:'#155f78',700:'#124b5e',800:'#0d3846',900:'#08242e',main:'#155f78',light:'#1d7794',dark:'#124b5e',contrastText:'#fff' };
const teal: ShadeRecord = { 50:'#effaf8',100:'#d5f1ed',200:'#a8e3db',300:'#6ecfc2',400:'#37b5a5',500:'#168e80',600:'#0f7468',700:'#0b5a51',800:'#08443d',900:'#052d29',main:'#0f7468',light:'#168e80',dark:'#0b5a51',contrastText:'#fff' };

export const theme = createTheme({
  palette: {
    mode: 'light', primary: red, secondary: green,
    savannah: gold as any, terracotta: red as any, saffron: gold as any, ink: black as any,
    maasai: red as any, shuka: blue as any, victoria: blue as any, acacia: green as any, diani: teal as any,
    background: { default:'#f7f5f0', paper:'#ffffff', surface:'#ffffff', surfaceVariant:'#f1eee7', canvas:'#f7f5f0' },
    text: { primary:'#182020', secondary:'#526060', disabled:'#8b9694' }, divider:'#e2ded5',
    error:{ main:'#b42318' }, warning:{ main:'#a66e0b' }, success:{ main:'#176b2b' }, info:{ main:'#155f78' },
    action:{ hover: alpha('#176b2b',0.06), selected: alpha('#a52d29',0.09), hoverOpacity:0.06, selectedOpacity:0.09, disabledBackground:alpha('#182020',0.04), disabledOpacity:0.38 },
  },
  typography: {
    fontFamily:'Roboto, Arial, sans-serif',
    h1:{ fontFamily:'Georgia, serif', fontWeight:700, fontSize:'clamp(2.5rem, 5vw, 4.4rem)', lineHeight:1.04, letterSpacing:'-0.045em' },
    h2:{ fontFamily:'Georgia, serif', fontWeight:700, fontSize:'clamp(2rem, 3.5vw, 3.2rem)', lineHeight:1.1, letterSpacing:'-0.035em' },
    h3:{ fontFamily:'Georgia, serif', fontWeight:700, fontSize:'2.25rem', lineHeight:1.15, letterSpacing:'-0.025em' },
    h4:{ fontWeight:700, fontSize:'1.75rem', lineHeight:1.2, letterSpacing:'-0.02em' },
    h5:{ fontWeight:700, fontSize:'1.35rem', lineHeight:1.3 }, h6:{ fontWeight:700, fontSize:'1.1rem', lineHeight:1.35 },
    subtitle1:{ fontWeight:600, fontSize:'1rem', lineHeight:1.55 }, subtitle2:{ fontWeight:600, fontSize:'.875rem', lineHeight:1.5 },
    body1:{ fontWeight:400, fontSize:'1rem', lineHeight:1.7 }, body2:{ fontWeight:400, fontSize:'.875rem', lineHeight:1.65 },
    button:{ fontWeight:700, fontSize:'.875rem', textTransform:'none' }, caption:{ fontWeight:600, fontSize:'.75rem', lineHeight:1.5 }, overline:{ fontWeight:700, fontSize:'.7rem', textTransform:'uppercase', letterSpacing:'.14em' },
  },
  shape:{ borderRadius:12, pill:999, card:18, button:10, chip:8 } as any, spacing:8,
  breakpoints:{ values:{ xs:0, sm:640, md:768, lg:1024, xl:1280 } },
  components:{
    MuiCssBaseline:{ styleOverrides:{ html:{ scrollBehavior:'smooth' }, body:{ backgroundColor:'#f7f5f0', WebkitFontSmoothing:'antialiased' }, '::selection':{ background:alpha('#a52d29',.18), color:'#641b19' } } },
    MuiButton:{ defaultProps:{ disableElevation:true }, styleOverrides:{ root:{ borderRadius:10, paddingInline:18, paddingBlock:10, fontWeight:700 }, containedPrimary:{ background:'#a52d29', '&:hover':{ background:'#83211e' } }, containedSecondary:{ background:'#176b2b', '&:hover':{ background:'#105321' } }, outlinedPrimary:{ borderColor:alpha('#a52d29',.35), '&:hover':{ borderColor:'#a52d29', background:alpha('#a52d29',.05) } } } as any },
    MuiCard:{ styleOverrides:{ root:{ borderRadius:'18px', boxShadow:'0 6px 20px rgba(24,32,32,.06)', borderColor:'#e2ded5' } } },
    MuiPaper:{ styleOverrides:{ rounded:{ borderRadius:'18px' } } },
    MuiTextField:{ defaultProps:{ variant:'outlined', size:'small' } },
    MuiOutlinedInput:{ styleOverrides:{ root:{ borderRadius:10, background:'#fff', '& fieldset':{ borderColor:'#d8d5cc' }, '&:hover fieldset':{ borderColor:'#a52d29' }, '&.Mui-focused fieldset':{ borderWidth:2, borderColor:'#a52d29' } } } },
    MuiChip:{ styleOverrides:{ root:{ borderRadius:8, fontWeight:700 } } },
    MuiAppBar:{ styleOverrides:{ root:{ background:'#fff', color:'#182020', boxShadow:'0 1px 0 #e2ded5' } } },
    MuiDrawer:{ styleOverrides:{ paper:{ background:'#fff', borderRight:'1px solid #e2ded5' } } },
    MuiTooltip:{ styleOverrides:{ tooltip:{ background:'#182020', borderRadius:8, fontSize:12 } } },
  },
});

export default theme;
