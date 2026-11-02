'use client';
import React,{useEffect} from 'react';
import NextLink from 'next/link';
import{usePathname,useRouter}from'next/navigation';
export function BrowserRouter({children}){return children}
export function Link({to,children,...props}){return <NextLink href={to} {...props}>{children}</NextLink>}
export function Navigate({to}){const router=useRouter();useEffect(()=>{router.replace(to)},[router,to]);return null}
export function Route(){return null}
export function Routes({children}){const path=usePathname();for(const child of React.Children.toArray(children)){const route=child.props.path;if(route==='*'||route===path||route.includes(':')&&new RegExp('^'+route.replace(/:[^/]+/g,'[^/]+')+'$').test(path))return child.props.element}return null}
export function useNavigate(){const r=useRouter();return to=>r.push(to)}
export function useParams(){const path=usePathname();return{id:path.split('/').filter(Boolean).at(-1)}}
